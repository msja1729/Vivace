# The Live Viva Engine (the AI during an interview)

While an examiner interviews a student, the backend runs two pipelines on what the student's browser sends:

- the **Integrity Engine** watches the camera and microphone for cheating signals → **flags** and a
  **Cheating Risk Score**;
- the **Evaluation Engine** transcribes both people and grades each answer → a **Conceptual Mastery Score**
  and **suggested questions** (the Co-Pilot).

Both feed the examiner's screen live and the report afterwards. **They advise; the examiner decides.**

Code: `backend/app/live/`. Thresholds and weights: `backend/config.yaml`. How the data arrives (WebSocket,
frames, audio) is in [API_AND_COMMUNICATION.md](API_AND_COMMUNICATION.md#6-the-live-room-websocket).

---

## 1. The big picture

```
 Student's browser                         Backend (one LiveSession per student)                     Examiner's screen
 ─────────────────                         ─────────────────────────────────────                     ─────────────────
 camera ─ 5 JPEG/s ──► frame worker ──► VISION (face mesh + YOLO) ──► IntegrityMonitor ──► flags ──► event log, snapshots
                                                       │                     ▲                       overlay on video
                                                       └── overlay data ─────┼──────────────────────►
 mic ──── 16 kHz ────► VAD segmenter ──► speech segments ──► Whisper ──► transcript turns ─────────► transcript
                            │                     └──► voice print check ─┘ (another voice?)
                            └── "is the student speaking?" ──► lip-sync check
 examiner mic ─ 16 kHz ► VAD segmenter ──► Whisper ──► examiner turns (= questions)

 question + answer ──► delivery metrics + course context (RAG) ──► Grader (Claude) ──► mastery ───► scores, notes per answer
                                                                     └► Co-Pilot (Examiner / Devil's Advocate) ─► suggestions
 every second: risk + mastery + health ────────────────────────────────────────────────────────────► meters
```

| File | Role |
|---|---|
| `live/session.py` | `LiveSession`: the room for one student — connections, workers, message routing, saving to the database. `Hub`: all rooms in memory |
| `live/engines.py` | Loads each AI model once (lazily), reports which ones work |
| `live/config.py` + `config.yaml` | Thresholds and weights |
| `live/integrity/vision.py` | Analyses one frame |
| `live/integrity/rules.py` | Turns observations over time into flags; computes risk |
| `live/integrity/audio.py` | Voice activity segmentation, voice print, speech-to-text |
| `live/evaluation/metrics.py` | Delivery metrics and the mastery formula |
| `live/evaluation/context.py` | Reads the student's work and course files; finds relevant passages (RAG); similarity |
| `live/evaluation/llm.py` | The connection to Claude (swappable) |
| `live/evaluation/agents.py` | The three agents: Examiner, Devil's Advocate, Grader |

---

## 2. The AI models

| Model | What it does | Library | Size / speed (this laptop, CPU) |
|---|---|---|---|
| **MediaPipe Face Landmarker** | Finds faces and 478 points on each (incl. irises), 52 facial "blendshapes" (eye look direction, jaw open …) and the head's rotation | `mediapipe` | ~4 MB. Downloaded to `backend/models/` |
| **YOLOv8n** | Detects objects: person, cell phone, laptop, tv, book | `ultralytics` | ~6 MB. Face + YOLO together ≈ 35 ms per frame |
| **WebRTC VAD** | "Is this 30 ms of audio speech?" | `webrtcvad` | Tiny, instant |
| **faster-whisper `base.en`** | Speech-to-text, with a time for every word | `faster-whisper` | ~150 MB. A 5 s answer appears ≈ 2.5 s after the speaker stops |
| **SpeechBrain ECAPA** | Turns a voice clip into 192 numbers (a "voice print") | `speechbrain` | ~80 MB |
| **all-MiniLM-L6-v2** | Turns text into 384 numbers so meanings can be compared | `sentence-transformers` | ~90 MB |
| **Claude** (`claude-sonnet-5-5`) | Grades answers, writes suggested questions | Anthropic API (internet) | Needs `ANTHROPIC_API_KEY` |

**Loading:** at backend start, `warm_up()` loads them in the background (first time: downloads, about a minute).
Each loader is wrapped so that a missing package or failed download **switches off only that detector**; the
examiner's screen lists which engines are off. `GET /api/live/engines` shows the status.

**CPU or GPU:** `ML_DEVICE=auto` uses an NVIDIA GPU if the installed PyTorch supports it. The current install
is the CPU build of PyTorch, so everything runs on CPU.

**Threads:** the AI work runs in background worker threads so the server stays responsive:

| Pool | Threads | Runs |
|---|---|---|
| Vision | 3 | Face mesh + YOLO (each thread keeps its own copy of the models) |
| Speech-to-text | 1 | Whisper, strictly in arrival order |
| Misc | 2 | Voice prints, text embeddings, reading the student's documents |

The frame worker always analyses the **latest** frame and drops older ones if it falls behind, so analysis
never lags further and further behind the video.

---

## 3. Integrity Engine

### 3.1 What one frame produces (`vision.py`)

| Observation | How |
|---|---|
| Number of faces, face boxes | Face Landmarker (up to 3 faces). The biggest face is taken to be the student |
| Head **yaw** (left/right) and **pitch** (up/down), degrees | From the face's rotation matrix |
| **Eye direction** `eye_x`, `eye_y` (−1 … 1) | From the eye-look blendshapes (look in/out/up/down for each eye) |
| **Mouth opening** (0 … 1) | The `jawOpen` blendshape |
| Mesh points for the overlay | Face outline, eyes, lips, iris centres |
| Objects + number of people | YOLOv8n at 320 px, confidence ≥ 0.5 |

### 3.2 Calibration (before the interview)

1. **Four corners.** While the dot visits each screen corner, every frame's eye direction and head angle are
   recorded. The **screen bounds** are the range of eye directions seen, widened by 25 % of that range plus a
   0.12 margin; the head's usual angle is the median. Fewer than 8 good frames → default bounds
   (eye_x ±0.45, eye_y −0.5…+0.45).
2. **Voice sample.** The audio while the student reads the sentence becomes their **voice print** (an ECAPA
   embedding). If this step was skipped or failed, the student's first answer of 3 s or more is used instead.

Both are saved in `viva_sessions.calibration`, so a reconnect doesn't need recalibrating.

### 3.3 The detectors (`rules.py`)

A flag **opens** once its condition has held for the minimum time, stays open while it continues (its end time
moves on), and **closes** when the condition stops. Each flag is saved with a **snapshot** (the frame at the
moment it opened) and a confidence.

| Flag | Condition | Minimum time (config) |
|---|---|---|
| `gaze_off_screen` | One face, eyes outside the calibrated screen bounds | 3 s (`gaze_off_seconds`) |
| `head_turned` | Head turned more than 30° sideways or 20° up/down from the calibrated position | 3 s (`head_turn_seconds`) |
| `reading_pattern` | ≥ 3 left-right eye sweeps (each ≥ 0.15) within 10 s — like reading lines of text | instant |
| `no_face` | No face in view | 3 s (`no_face_seconds`) |
| `multiple_faces` | More than one face | 0.3 s (two frames in a row, to ignore glitches) |
| `prohibited_object` | Cell phone, laptop, tv or book seen in ≥ 3 of the last 5 frames | instant |
| `second_person` | YOLO sees 2+ people in ≥ 3 of the last 5 frames | instant |
| `secondary_speaker` | A student speech segment (≥ 1.5 s, not overlapping the examiner) whose voice matches the voice print with cosine similarity < 0.5 | per segment |
| `lipsync_mismatch` | Over the last 2 s: the student's mic hears speech ≥ 60 % of the time (ignoring moments the examiner is talking), but the mouth barely moves (max opening < 0.12, variation < 0.025) | 2 s (`lipsync_seconds`) |

Why the examiner's speaking is excluded: their voice comes out of the student's speakers and can leak into the
student's mic. The browser's echo cancellation removes most of it; the rules ignore the rest.

### 3.4 Cheating Risk Score (0–100)

```
risk = min(100,  Σ over flags in the last 10 minutes of   weight(type) × (1 + duration_seconds / 10) )
```

| Flag | Weight | | Flag | Weight |
|---|---|---|---|---|
| second_person | 25 | | lipsync_mismatch | 12 |
| multiple_faces | 20 | | reading_pattern | 10 |
| prohibited_object | 20 | | no_face | 8 |
| secondary_speaker | 20 | | gaze_off_screen | 6 |
| | | | head_turned | 5 |

- The live meter shows the score over the rolling window (`risk_window_seconds: 600`).
- The **stored** session score is the **peak** reached, so a cheating episode isn't "forgotten" after
  10 minutes.
- Bands in the report: **low** < 30, **medium** 30–59, **high** ≥ 60.
- Example: a phone visible for 5 s → 20 × (1 + 0.5) = 30 → medium.

All numbers are in `backend/config.yaml`; edit and restart the backend to change them.

---

## 4. Evaluation Engine

### 4.1 Cutting audio into utterances (`audio.py` → `Segmenter`)

Audio arrives in 100 ms chunks and is examined 30 ms at a time by the VAD:

- **Speech starts** when 4 of the last 6 frames are speech (150 ms before that is kept, so the first word
  isn't clipped).
- **Speech ends** after 750 ms of silence (trailing silence removed), or after 20 s (long monologues are
  split).

Each finished segment becomes one job for speech-to-text. The student and the examiner each have their own
segmenter, so the transcript knows who spoke without guessing.

### 4.2 Speech-to-text

Whisper (`base.en`, English, fastest settings) transcribes each segment with per-word times. The text becomes a
**turn** (`viva_turns`), shown live in the transcript. Bigger models (`WHISPER_MODEL=small.en`) are more
accurate but slower.

### 4.3 Pairing questions with answers

```
examiner turn(s)  →  "the question"
student turn(s)   →  "the answer" (all student lines until the examiner speaks again)
examiner speaks again  →  the previous answer is closed and GRADED (in the background)
```

Also graded: the current answer when the examiner clicks "Grade the current answer now", and the last answer
when the interview ends. Questions the examiner types and "shows" count as examiner turns. Answers under
4 words aren't graded.

### 4.4 Delivery metrics (`metrics.py`)

| Metric | Meaning | Score (0–1) |
|---|---|---|
| **Latency** | From the end of the question to the first word of the answer | 1 up to 2 s, falling to 0 at 12 s |
| **Speaking rate** | Words per minute while speaking | 1 within 100–170 wpm, less outside |
| **Filler rate** | "um", "uh", "like", "basically", "you know" … per minute | 1 − rate / 12 |
| **Long pauses** | Silences over 2 s between words | 1 − 0.15 per pause |

**Fluency** = the average of these scores.

### 4.5 Course context (RAG) (`context.py`)

When the room opens, the backend reads (in the background):

- the student's **submission** for the viva's linked assignment (resume, project files, notes, GitHub links),
- the viva's **instruction files**, and
- the class **material**.

Text is pulled out of PDF, DOCX, PPTX, notebooks and text files, cut into 900-character chunks (150 overlap),
and each chunk is embedded with MiniLM. For each question/answer, the **4 closest chunks** are given to the LLM
as evidence. A short version of the student's own submission is always included. ("RAG" = retrieve the
relevant passages, then generate.) Without the embedding model, chunks are ranked by shared words instead.

### 4.6 The agents (`agents.py`)

Each agent is one call to Claude with its own instructions (**system prompt**) and the shared **exam state**:
the viva's title, the instructor's interview instructions, the evaluation criteria, the student's work and the
dialogue so far.

| Agent | When | Produces |
|---|---|---|
| **Grader** | After each answer | `correctness` (0–1), `depth` (0–1), `memorization_flag`, a short reasoning, strengths, weak points, a reference answer (what a strong answer would say), and a 0–10 score for each criterion the answer gave evidence for |
| **Examiner** | When the console opens (opening questions), and after a good answer (follow-ups on open weak points or new topics) | 3 suggested questions with what each tests and which criterion |
| **Devil's Advocate** | After an answer that sounded memorised or was shallow (depth < 0.5) | Counter-scenarios ("what if the data were 10× larger?"), changes to their own design, or statements with a planted flaw to catch |

The answers are requested in a fixed **JSON shape** (structured output), so the backend can read them reliably.
If Claude declines a request for safety reasons, the API automatically retries on its recommended fallback
model. Errors (no key, rate limit, no internet) are shown as a one-line message in the Co-Pilot panel; the rest
of the session keeps working.

The LLM sits behind a tiny interface (`LLM` in `llm.py`), so another provider (e.g. a local model) could be
plugged in without changing the agents.

### 4.7 Conceptual Mastery Score (0–100)

For each graded answer:

```
mastery = 100 × (0.5 × correctness + 0.3 × similarity + 0.2 × fluency)
```

- **similarity** = how close the answer's meaning is to the Grader's reference answer (MiniLM cosine).
- If a part is missing (e.g. no embedding model → no similarity), the remaining weights are re-scaled.
- Without the Grader (no API key), mastery is not computed — fluency alone says nothing about understanding.

The **session mastery** is the average over graded answers. The weights are in `config.yaml`
(`mastery_weights`).

Everything about an answer is stored in the `analysis` field of its first transcript line: question, latency,
wpm, fillers, pauses, fluency, correctness, depth, similarity, memorised?, reasoning, strengths, weak points,
reference answer, per-criterion scores, mastery.

---

## 5. What the examiner sees, and when

| Every | Message | Shown as |
|---|---|---|
| analysed frame (~5/s) | `frame` | Overlay: face box, mesh, yellow gaze arrow, red object boxes |
| flag opens / closes | `event` | Integrity flag list (open flags highlighted red), click for snapshot |
| utterance transcribed | `turn` | Transcript line |
| answer graded | `grade` | Notes under the answer; mastery meter |
| Co-Pilot update | `suggestions` | Suggested questions |
| second | `scores` | Risk and mastery meters, vision fps, "student speaking" |

At the end, the examiner's result form is pre-filled with each criterion's average Grader score; the examiner
can change everything.

---

## 6. Privacy and fairness

- Students see a **consent screen** listing what is analysed before the camera turns on.
- **No video or audio recording** is stored — only flag snapshots (deleted after `SNAPSHOT_RETENTION_DAYS`) and
  the transcript text.
- Everything runs on the institute's/your server, except the text sent to Claude for grading (question, answer,
  relevant passages).
- Flags and AI scores are **advisory**: the report says so, and the examiner's score is the decision.
- Known limits: lighting, glasses and camera angle affect gaze; non-native accents affect transcription
  (larger Whisper models help); a TA's voice leaking through speakers is mostly, not perfectly, filtered.

---

## 7. Tuning (`backend/config.yaml`)

```yaml
vision:     fps, yolo_imgsz, yolo_conf
integrity:  gaze_off_seconds, head_yaw_deg, head_pitch_deg, head_turn_seconds, reading_sweeps,
            reading_window_seconds, no_face_seconds, object_frames, objects, speaker_similarity, lipsync_seconds
risk_weights: one weight per flag type
risk_window_seconds
mastery_weights: correctness, similarity, fluency
```

Examples: too many "looking away" flags → raise `gaze_off_seconds` to 5; don't count books → remove `book`
from `objects`. Restart the backend after editing.
