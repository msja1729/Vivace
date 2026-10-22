# How the Whole App Works — Start Here

This is the overview of the project: what the pieces are, what each one does, and how they talk to each other.
It assumes no web-development background. Every technical word is explained the first time it appears, and
there is a glossary at the end.

When you want more detail on one piece, each has its own guide:

| Guide | What it covers |
|---|---|
| [FRONTEND_EXPLAINED.md](FRONTEND_EXPLAINED.md) | The website: pages, components, how the browser side is organised |
| [BACKEND_EXPLAINED.md](BACKEND_EXPLAINED.md) | The server: layers, rules, permissions, how a request is handled |
| [DATABASE_AND_FILES.md](DATABASE_AND_FILES.md) | What is stored, in which tables, and where uploaded files and snapshots go |
| [API_AND_COMMUNICATION.md](API_AND_COMMUNICATION.md) | Every call between browser and server, the live-room WebSocket messages, and the video call (WebRTC) |
| [LIVE_VIVA_ENGINE.md](LIVE_VIVA_ENGINE.md) | The AI during a viva: cheating detection, speech-to-text, grading, the Co-Pilot, the scores |
| [RUNNING_AND_TESTING.md](RUNNING_AND_TESTING.md) | Starting the app, demo data, tests, common problems, and what deploying would involve |

Suggested reading order: this file → API_AND_COMMUNICATION → FRONTEND → BACKEND → DATABASE_AND_FILES →
LIVE_VIVA_ENGINE → RUNNING_AND_TESTING.

---

## 1. What the app is

A class platform, similar in spirit to Microsoft Teams or Google Classroom, built around **oral exams (vivas)**:

- An **instructor** creates a class. Students join it with a 6-character code.
- The instructor can add **TAs** (teaching assistants). In that class, TAs get the instructor's powers, except
  managing other TAs.
- Staff (instructor + TAs) share **files**, set **assignments** (students upload work before a deadline), and
  set up **vivas**.
- A viva is currently run **by people**: the instructor and TAs each interview their allotted students one-to-one
  by video, in time slots, in parallel. (An "AI examiner" mode, where the AI asks the questions itself, is
  planned but not built.)
- While an interview runs, the **AI assists**: it watches for cheating signals on the student's camera and
  microphone, transcribes both people, grades each answer, and suggests follow-up questions to the examiner.
- Afterwards there is a **per-student report** and **class statistics**. The examiner's score is the decision;
  the AI's numbers are advice.

---

## 2. The pieces (components)

```
                  ┌───────────────────────────────── your laptop (today) ──────────────────────────────────┐
                  │                                                                                        │
 Student's   ───► │  FRONTEND  (Next.js, port 3000)        BACKEND  (FastAPI / Python, port 8000)          │
 browser          │  sends the web pages + code    ──────► API: logins, classes, assignments, vivas …      │
                  │  to each browser                       Live-viva engine: AI models (vision, speech)    │
 Examiner's  ───► │                                         │                                              │
 browser          │                                         ├── DATABASE  (SQLite file: backend/viva.db)    │
                  │                                         ├── FILES     (backend/uploads/)                │
                  │                                         └── AI MODELS (backend/models/ + HF cache)      │
                  └────────────────────────────────────────────────────────────────────────────────────────┘
                                                            │
                         outside services (internet) ───────┤  Claude API (grading, Co-Pilot) — optional
                                                            │  Microsoft sign-in (Entra ID) — optional
                                                            └  Google STUN server (helps set up video calls)

 During a viva, the video and voice go DIRECTLY between the two browsers (WebRTC).
 The backend only introduces them, and separately receives a copy of the student's frames + audio for the AI.
```

| Piece | What it is | Its job | Where the code is |
|---|---|---|---|
| **Browser** | Chrome/Edge on each person's computer | Shows the pages, runs the frontend code, uses the camera and microphone | — |
| **Frontend** | A Next.js (React) website | Everything you see and click. Asks the backend for data, never stores it | `frontend/` |
| **Backend API** | A Python FastAPI server | Checks who you are and what you may do, stores and returns data | `backend/app/` (except `live/`) |
| **Live-viva engine** | Part of the backend | Runs the AI during interviews: vision, audio, grading, scores | `backend/app/live/` |
| **Database** | One SQLite file | Remembers users, classes, assignments, vivas, sessions, flags, transcripts | `backend/viva.db` |
| **File storage** | A folder on disk | Uploaded files (resumes, submissions, material) and integrity snapshots | `backend/uploads/` |
| **AI models** | Downloaded model files | Face mesh, YOLO object detector, Whisper speech-to-text, voice print, text embeddings | `backend/models/` and the Hugging Face cache in your user folder |
| **Claude API** | Anthropic's hosted AI (internet) | Grades answers and writes suggested questions. Needs `ANTHROPIC_API_KEY` | called from `backend/app/live/evaluation/llm.py` |
| **Microsoft sign-in** | Microsoft Entra ID (internet) | Real school-account login. Off until Azure IDs are set; a "developer sign-in" is used meanwhile | `frontend/src/lib/auth/microsoft.ts`, `backend/app/core/microsoft.py` |
| **STUN server** | A free Google server | Helps two browsers find each other's network address for the video call | `frontend/src/lib/live/room.ts` |

### Why split frontend and backend?

- The **frontend** runs in the browser, which anyone can inspect and modify. So it can't be trusted to enforce
  rules ("only staff see marks"). It only displays things.
- The **backend** runs on a machine you control. Every rule is checked there, on every request. Even if someone
  edits the frontend in their browser, the backend still refuses what they aren't allowed to do.
- They are separate programs, so each can be changed, tested, or moved to a different machine on its own.

---

## 3. How they talk to each other

There are **three kinds of communication**. All three are explained fully in
[API_AND_COMMUNICATION.md](API_AND_COMMUNICATION.md).

### 3.1 Normal requests (REST API over HTTP)

Almost everything — signing in, creating a class, uploading an assignment, saving a viva setup — is one
**request** from the browser and one **response** from the backend:

```
Browser                                            Backend
  │  POST http://localhost:8000/api/classes/join      │
  │  Authorization: Bearer eyJhbGciOi…  (who I am)     │
  │  { "code": "K7M2QX" }               (the data)     │
  │ ─────────────────────────────────────────────────► │  1. check the login token
  │                                                    │  2. check the rules
  │                                                    │  3. read / write the database
  │ ◄───────────────────────────────────────────────── │
  │  200 OK  { "id": "…", "name": "ML", … }            │
```

- **HTTP** is the language browsers and servers speak. A request has a **method** (`GET` read, `POST` create,
  `PUT` update, `DELETE` remove), a **path** (`/api/classes/join`), optional **headers** (extra labels) and a
  **body** (the data).
- **JSON** is the text format of the data: `{"name": "Asha", "role": "student"}`.
- **REST API** just means "a fixed list of addresses, each doing one job". The full list is in
  [API_AND_COMMUNICATION.md](API_AND_COMMUNICATION.md#3-every-endpoint).
- The **login token** (a JWT) is how the backend knows who is calling: you get it when you sign in, the browser
  keeps it, and attaches it to every request.

### 3.2 The live room (WebSocket)

During a viva, the backend and both browsers need to send messages **at any moment**, not only as
request → response: "a flag just opened", "here is the transcript line", "the examiner started the
interview", plus 5 camera frames per second from the student. For that the browser opens a **WebSocket**: one
connection that stays open, through which both sides can send messages whenever they like.

```
Student's browser ══════ WebSocket ══════► Backend ◄══════ WebSocket ══════ Examiner's browser
   sends: camera frames (5/s), audio,          relays the handshake,            sends: start / end,
          calibration steps                     runs the AI, pushes results      questions, its audio
   gets:  questions, "ended"                                                     gets: overlays, flags, scores,
                                                                                       transcript, suggestions
```

### 3.3 The video call itself (WebRTC)

The face-to-face call between examiner and student uses **WebRTC**, a technology built into browsers for
direct video calls. The video and voice go **straight from one browser to the other** — the backend never
carries them. The backend's only role is to pass the "handshake" notes between the two browsers (through the
WebSocket above) so they can find each other.

This is why the AI copy of the student's camera is sent separately: the backend doesn't see the call, so the
student's browser sends it a few still frames and the audio on the side.

---

## 4. A tour of the main features

| Feature | Who | What happens (simplified) |
|---|---|---|
| **Sign in** | everyone | Developer sign-in (name + school email) or Microsoft sign-in → backend creates/finds the user → returns a token. First time: pick Student or Instructor (once) |
| **Classes** | instructor creates, anyone joins | Create → backend makes a 6-char join code → students type it to join |
| **TAs** | class owner | Search registered users by email → add as TA → they get staff powers in that class |
| **Files** | staff upload, students download | Class material stored in `uploads/`. Students only see material, never other students' work |
| **Assignments** | staff set, students submit | Title, instructions, deadline, optional marks → students upload files/links until the deadline → staff see submitted / late / missing, return marks + feedback |
| **Viva setup** | staff | Title, start time, length, break between students, who conducts it, **examiners + allocation** (who interviews whom, in what order), instructions for the AI, criteria, report format, statistics |
| **Allocation** | staff | Each examiner has a queue. Slot *n* starts at `start + n × (length + break)`. Examiners run in parallel |
| **Joining a viva** | student | Student sees their own slot and examiner. Must click Join within **5 minutes** of their slot, otherwise "missed" |
| **Live room** | examiner + student | Consent → camera/mic check → calibration → waiting room → examiner starts → interview with AI assistance → examiner ends → enters result |
| **Report** | staff | Summary scores, integrity timeline with snapshots, every answer with the AI's notes, full transcript. "Download PDF" prints it |
| **Statistics** | staff | Per student: examiner, slot, score, mastery, risk, flags. Class: average, distribution, per-criterion averages, flag counts |
| **Feedback** | staff → student | Staff send written feedback and files; the student sees it on their viva page |

---

## 5. Example: what happens during one viva, end to end

1. **Setup (instructor).** In Setup, the instructor picks "Instructor & TAs", ticks the examiners, clicks
   "Split evenly", adjusts the order, and clicks "Schedule viva". The backend checks every student has an
   examiner and the time is in the future, then saves it.
2. **Waiting (student).** Asha's viva page shows "Your slot 10:20, with Tara TA" and a countdown.
3. **Joining.** At 10:20 the Join button appears. Asha clicks it (`POST /api/vivas/{id}/join`). The backend
   checks she is within her 5-minute window and records the time.
4. **Device check & calibration.** Asha's browser asks for camera and microphone permission, shows a preview
   and a mic level bar, then opens the **WebSocket** to the live room. She follows a dot to the 4 screen
   corners (the backend records where her eyes point when she looks at the screen edges) and reads one sentence
   (the backend records a **voice print** of her voice).
5. **Examiner opens the room.** Tara clicks "Open room" in the Live room tab. Her browser opens its own
   WebSocket to the same room. Seeing that Asha is online, Tara's browser starts the **WebRTC** handshake;
   the backend relays it; the two browsers connect and the video call begins.
6. **Interview.** Tara clicks "Start interview". From now on:
   - Asha's browser sends 5 frames/second + audio to the backend. The **integrity engine** checks each frame
     (face, gaze, head pose, phone/book/extra person) and the audio (another voice? speaking while the lips are
     still?). Each problem becomes a **flag** with a snapshot. The **risk score** goes up.
   - Both browsers' audio is cut into utterances and transcribed by **Whisper**. Tara's lines become
     "questions", Asha's lines "answers".
   - When Tara asks the next question, the previous answer is **graded** by Claude (correctness, depth,
     sounds memorised?, weak points) and measured for delivery (latency, fillers, pace) → the **mastery
     score**. The **Co-Pilot** then suggests next questions.
   - Tara's screen shows all of this live: overlays on the video, the two scores, transcript, flags, suggestions.
7. **End.** Tara clicks "End interview". Asha's screen says it's over. Tara enters the scores (pre-filled with
   the AI's suggestions) and notes, and saves.
8. **Afterwards.** The report and statistics are available to staff. Staff can send feedback to Asha.

---

## 6. Who can do what (permissions)

| Role | Means | Can |
|---|---|---|
| **Instructor** (account role) | Chose "Instructor" at registration | Create classes |
| **Owner** | The instructor who created a class | Everything in that class, incl. adding/removing TAs, stepping into any examiner's interviews |
| **TA** | Added to a class by its owner | Everything the owner can in that class, except managing TAs. Conducts their allotted interviews |
| **Student** | Joined the class with the code | See material, submit assignments, take vivas they're assigned to, see their own feedback |
| **Outsider** | Not in the class | Nothing. The backend answers "not found", so it doesn't even reveal the class exists |

Every one of these checks happens **in the backend**. The frontend hides buttons too, but only for convenience.

---

## 7. Project folder map

```
Project - 3/
├── frontend/                 The website (Next.js + React + TypeScript + Tailwind)
│   └── src/
│       ├── app/              Pages. Folder = URL. (public)/ = signed-out pages, (app)/ = signed-in pages
│       ├── components/       Building blocks: ui/, layout/, classes/, assignments/, vivas/, live/, student/ …
│       ├── lib/              Logic: api/ (calls to the backend), auth/ (sign-in), live/ (WebSocket, WebRTC, media)
│       └── types/            Shapes of the data (TypeScript types)
├── backend/                  The server (Python + FastAPI)
│   ├── app/
│   │   ├── main.py           Starts the app, loads models in the background, registers all routes
│   │   ├── api/routes/       The endpoints (one file per area)
│   │   ├── services/         The rules (who may do what, scheduling, stats …)
│   │   ├── models/           Database tables
│   │   ├── schemas/          Shapes of the JSON going in and out
│   │   ├── core/             Settings, database connection, tokens, errors, file storage, Microsoft check
│   │   └── live/             The live-viva engine (integrity + evaluation + session runtime)
│   ├── migrations/           Step-by-step database structure changes (Alembic)
│   ├── tests/                Automated tests (pytest)
│   ├── scripts/              Demo data helpers
│   ├── config.yaml           AI thresholds and score weights
│   ├── viva.db               The database (created on your machine, not in git)
│   ├── uploads/              Uploaded files and snapshots (not in git)
│   └── models/               Downloaded AI model files (not in git)
└── docs/                     These guides
```

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Frontend** | The part that runs in the browser: pages and buttons |
| **Backend** | The program on a server that stores data and enforces rules |
| **API** | The list of addresses (endpoints) the backend offers |
| **Endpoint** | One method + path, e.g. `POST /api/classes/join` |
| **HTTP** | The request/response language of the web |
| **JSON** | Plain-text data format: `{"key": "value"}` |
| **Token / JWT** | A signed string proving who you are; sent with every request |
| **Database** | Permanent, organised storage of records (rows in tables) |
| **SQLite** | A database that lives in a single file |
| **Migration** | A saved, step-by-step change to the database's structure |
| **WebSocket** | A connection that stays open so both sides can send messages any time |
| **WebRTC** | Browser technology for direct (peer-to-peer) video and audio calls |
| **STUN / TURN** | Helper servers for WebRTC: STUN tells a browser its public address; TURN relays the video when a direct path is blocked |
| **localhost** | "This same computer". `localhost:3000` is reachable only from your own laptop |
| **Port** | A numbered "door" on a computer; the frontend uses 3000, the backend 8000 |
| **CORS** | Browser rule: a page from one address may only call another address if that server allows it |
| **HTTPS** | Encrypted HTTP. Browsers allow camera/mic only on HTTPS or localhost |
| **Model (AI)** | A trained file that turns input (image, audio, text) into a prediction |
| **LLM** | Large language model, here Claude, used for grading and suggestions |
| **RAG** | Retrieval-augmented generation: find the relevant passages first, then give them to the LLM |
| **Deploy** | Put the app on a server that's always on, at a public HTTPS address |
| **Branch (git)** | A separate line of changes in the code history, e.g. `dev` for testing, `main` for releases |
