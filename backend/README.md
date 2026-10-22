# Backend

FastAPI + SQLAlchemy 2 + Alembic. Python 3.12, managed with [uv](https://docs.astral.sh/uv/).

## Run
```bash
cp .env.example .env              # optional — defaults work for local dev
uv sync --extra live              # install dependencies (+ the live viva models; plain `uv sync` skips them)
uv run alembic upgrade head       # create / update database tables
uv run uvicorn app.main:app --reload --port 8000
```
- API: http://localhost:8000/api
- Interactive docs (try every endpoint): http://localhost:8000/docs

## Test & lint
```bash
uv run pytest
uv run ruff check . && uv run ruff format .
```

## Layout
| Path | What's there |
|---|---|
| `app/main.py` | Creates the app, CORS, error handling, mounts routes under `/api` |
| `app/core/` | Settings (`config.py`), database (`db.py`), JWT tokens (`security.py`), error types (`errors.py`), file storage (`storage.py`) |
| `app/models/` | Database tables: `User`, `ClassRoom`, `ClassMember`, `ClassTA`, `Assignment`, `Submission`, `StoredFile`, `Viva`, `VivaStudent` |
| `app/schemas/` | Request/response shapes (JSON is camelCase to match the frontend) |
| `app/services/` | Business rules: classes, assignments (submitted / late / missing), vivas (setup, allocation, scheduling checks, stats), live sessions, files |
| `app/live/` | The live viva: `session.py` (the room: WebSocket, WebRTC relay, pipelines, aggregator), `integrity/` (vision, audio, rules → flags + risk), `evaluation/` (context/RAG, metrics, LLM, agents), `engines.py` (model loading) |
| `config.yaml` | Detector thresholds and risk / mastery weights for the live viva |
| `app/api/deps.py` | "Who is calling?" — reads the token, loads the user, checks registration |
| `app/api/routes/` | HTTP endpoints, thin: validate → call a service → return |
| `migrations/` | Alembic database migrations |
| `scripts/seed_demo.py` | Fills a class with demo students and submissions (dev only) |
| `tests/` | pytest, each test gets a fresh in-memory database and upload folder |

## Endpoints
"Staff" = the class owner and its TAs. Only the owner can manage TAs.

| Method | Path | Who | Does |
|---|---|---|---|
| GET | `/api/health` | anyone | Server + database check |
| POST | `/api/auth/microsoft` | anyone | Sign in with the Microsoft ID token from MSAL (verified against Microsoft's keys) → token |
| POST | `/api/auth/dev-login` | anyone (dev mode) | Local testing only: sign in with name + school email → token |
| GET | `/api/auth/config` | anyone | Which sign-in methods are on |
| GET | `/api/users/me` | signed in | Current user |
| PUT | `/api/users/me/role` | signed in | Pick Student / Instructor (once) |
| POST | `/api/classes` | instructor | Create class → join code |
| POST | `/api/classes/join` | registered | Join with a 6-char code |
| GET | `/api/classes/mine` | registered | Classes I teach / joined |
| GET | `/api/classes/{id}` | staff or student | Class details with `myRole` (join code shown to staff only) |
| GET | `/api/classes/{id}/members` | instructor or TA | Students in the class (TAs not included) |
| GET | `/api/classes/{id}/tas` | instructor or TA | Teaching assistants |
| GET | `/api/classes/{id}/ta-candidates?q=` | owner | Find registered users by email / name (3+ chars) |
| POST / DELETE | `/api/classes/{id}/tas`, `/api/classes/{id}/tas/{userId}` | owner | Add / remove a TA. TAs get the instructor's permissions in that class |
| POST / GET | `/api/classes/{id}/assignments` | staff | Set work: title, instructions, deadline, optional marks / list with counts |
| GET / PUT / DELETE | `/api/assignments/{id}` | staff | Roster with submitted / late / missing and files; edit; delete |
| POST | `/api/assignments/{id}/submission` | student | Turn in (again): any `files`, `keepFileIds` (earlier files to keep), `githubLinks`, `note` (multipart). Closed after the deadline |
| GET | `/api/classes/{id}/my-assignments`, `/api/assignments/{id}/mine` | student | Own assignments: status, own submission, returned marks / feedback / files |
| PUT | `/api/submissions/{id}/grade` | staff | Return with `marks` (graded, out of `totalMarks`), `feedback` and `attachments` files (multipart) |
| POST / GET | `/api/classes/{id}/vivas` | staff | New draft viva (`whole_class` or `selected`) / list |
| GET / PUT / DELETE | `/api/vivas/{id}` | staff | Setup: who conducts it (`staff` now; `ai` later), schedule, students, examiners + allocation (`examinerIds`, `allocation`: who interviews whom, in order), break between slots, interview instructions, criteria, report format, summary stats |
| POST | `/api/vivas/{id}/schedule`, `/unschedule` | staff | Publish after checking the setup is complete / back to draft |
| POST | `/api/vivas/{id}/join` | assigned student | Open the viva. Strict: only within 5 minutes of the start time — the student's own slot in staff-run vivas (`VIVA_JOIN_WINDOW_MINUTES`); later = missed, marked not on time |
| GET | `/api/vivas/{id}/queue` | staff | Staff-run vivas: my students in slot order, live status (the owner sees every examiner) |
| WS | `/api/ws/vivas/{id}/students/{studentId}?token=` | that student, their examiner, the owner | The live room: WebRTC signalling, 5 fps frames + 16 kHz audio in, telemetry / transcript / flags / Co-Pilot out |
| GET | `/api/viva-sessions/{id}` | staff | One student's session report: scores, integrity flags, graded answers, transcript |
| POST | `/api/viva-sessions/{id}/end` | staff | End the interview (the live room normally does this) |
| PUT | `/api/viva-sessions/{id}/result` | staff | The examiner's score (out of 10), per-criterion scores, notes |
| GET | `/api/viva-sessions/{id}/events/{eventId}/snapshot` | staff | JPEG snapshot of an integrity flag |
| GET | `/api/live/engines` | signed in | Which detectors / models are loaded |
| POST | `/api/vivas/{id}/files` | staff | Upload instruction files for the viva engine |
| GET | `/api/vivas/{id}/stats` | staff | Summary statistics: resumes ready, joined / missed, feedback sent, scores (once vivas run) |
| PUT | `/api/vivas/{id}/students/{studentId}/feedback` | staff | Send a student's viva feedback / report with `attachments` (multipart) |
| GET | `/api/classes/{id}/my-vivas`, `/api/vivas/{id}/mine` | student | Own scheduled vivas: timing, status (upcoming / open / in progress / attended / missed), released feedback |
| GET | `/api/classes/{id}/files` | staff or student | Staff: every file. Students: only class material (never other students' uploads) |
| POST | `/api/classes/{id}/files` | staff | Upload class material |
| GET | `/api/files/{id}/download` | see note | Staff: any class file. Students: own uploads, class material, feedback returned to them |
| DELETE | `/api/files/{id}` | staff | Staff uploads only; student submissions can't be deleted |

## Live vivas (instructor & TAs)
A staff-run viva is a one-to-one video interview. In Setup the instructor picks the examiners (themselves and any TAs)
and allocates students to them; each examiner takes their students one after another
(`start + position × (length + break)`), so the examiners run in parallel. Students see their own slot and examiner,
and must open the viva within 5 minutes of it.

During the interview the student's browser also sends 5 fps frames and 16 kHz audio to the server:
- **Integrity engine** — MediaPipe Face Landmarker (faces, head pose, eye gaze, mouth), YOLOv8n (phone, laptop,
  screen, book, extra people), WebRTC VAD + SpeechBrain ECAPA (another voice), lip-sync check. Each flag has times,
  confidence and a snapshot; the **Cheating Risk Score** is their weighted sum (weights in `config.yaml`).
- **Evaluation engine** — faster-whisper transcribes both people; when the examiner asks the next question, the
  previous answer is graded by Claude (correctness, depth, memorisation, weak points) against the student's
  submission and course material (retrieved with MiniLM embeddings), plus delivery metrics (latency, fillers,
  pace, pauses) → **Conceptual Mastery Score**. The Co-Pilot (Examiner + Devil's Advocate agents) suggests questions.

Models download on first use into `backend/models/` and the Hugging Face cache (~1 GB). The first start takes a
minute or two while they load. Runs on CPU; set `ML_DEVICE=cuda` with a CUDA build of PyTorch for a GPU.
Calls between two different networks may need a TURN server (only a public STUN server is configured).

## Sign in with Microsoft
1. Azure portal → Microsoft Entra ID → App registrations → New registration (your institute's tenant).
2. Add a **Single-page application** redirect URI: `http://localhost:3000/register` (and your real site later).
3. Copy the **Application (client) ID** and **Directory (tenant) ID** into `backend/.env`
   (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`) and `frontend/.env.local`
   (`NEXT_PUBLIC_AZURE_CLIENT_ID`, `NEXT_PUBLIC_AZURE_TENANT_ID`). Optionally `ALLOWED_EMAIL_DOMAINS=["iisc.ac.in"]`.
4. Set `AUTH_MODE=microsoft` to turn off the developer sign-in.

## Demo data
Sign in as an instructor, create a class, then fill it with 8 demo students and 6 submissions:
```bash
uv run python -m scripts.seed_demo <JOIN_CODE>
```

## Changing the database
Edit a model in `app/models/`, then:
```bash
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```
