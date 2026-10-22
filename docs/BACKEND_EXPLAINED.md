# How the Backend Works

The **backend** (`backend/`) is a Python program that runs on a server (today: your laptop, port 8000). It
decides who is allowed to do what, stores everything in the database, and runs the AI during live vivas. The
frontend only displays what it returns.

This guide covers the structure and the rules. The AI part has its own guide,
[LIVE_VIVA_ENGINE.md](LIVE_VIVA_ENGINE.md); the list of endpoints is in
[API_AND_COMMUNICATION.md](API_AND_COMMUNICATION.md); the tables are in
[DATABASE_AND_FILES.md](DATABASE_AND_FILES.md).

---

## 1. Tools

| Tool | What it is | What it does here |
|---|---|---|
| **Python 3.12** | The programming language | All backend code |
| **FastAPI** | A *web framework* (ready-made structure for APIs) | Turns Python functions into endpoints and WebSockets, checks incoming data, builds the `/docs` page |
| **Uvicorn** | A web *server* | Listens on port 8000 and hands requests to FastAPI |
| **SQLAlchemy 2** | An *ORM* (lets Python classes stand for database tables) | Tables and queries |
| **Alembic** | A *migration* tool | Creates/updates the tables step by step (`migrations/versions/`) |
| **SQLite** | A database in one file | `backend/viva.db`. Swappable for PostgreSQL by changing `DATABASE_URL` |
| **Pydantic** | Data-shape checking | Every request/response shape (*schema*). Wrong input → `422` automatically |
| **PyJWT** | JSON Web Tokens | Login tokens; also verifies Microsoft's tokens |
| **uv** | Python package/project manager | `uv sync`, `uv run …` |
| **pytest**, **ruff** | Tests; code checker/formatter | `uv run pytest`, `uv run ruff check .` |
| **AI libraries** (the `live` extra) | MediaPipe, Ultralytics YOLO, faster-whisper, SpeechBrain, webrtcvad, sentence-transformers, pypdf, Anthropic SDK, OpenCV, NumPy, PyYAML | The live-viva engine. Installed with `uv sync --extra live`; without them the app still runs, the AI parts just switch off |

---

## 2. Folder structure

```
backend/
├── app/
│   ├── main.py              Creates the app: CORS, error handler, all routes under /api, and at startup
│   │                        deletes expired snapshots and loads the AI models in the background
│   ├── core/                Shared plumbing
│   │   ├── config.py        All settings (read from .env)
│   │   ├── db.py            Database connection, one session per request, UTC time helper
│   │   ├── security.py      Create / check our login tokens (JWT)
│   │   ├── microsoft.py     Check Microsoft sign-in tokens
│   │   ├── storage.py       Save / delete uploaded files on disk
│   │   └── errors.py        BadRequest, Unauthorized, Forbidden, NotFound, Conflict
│   ├── models/              Database tables: user, classroom, assignment, file, viva, live
│   ├── schemas/             JSON shapes going in and out: user, classroom, assignment, file, viva, live
│   ├── services/            THE RULES: users, classes, assignments, files, vivas, live
│   ├── api/
│   │   ├── deps.py          "Who is calling?": database session, signed-in user
│   │   └── routes/          Endpoints: health, auth, classes, assignments, files, vivas, live (incl. WebSocket)
│   └── live/                The live-viva engine (see LIVE_VIVA_ENGINE.md)
├── migrations/              Alembic migrations (one file per database change)
├── tests/                   88 automated tests
├── scripts/                 seed_demo.py (demo students + submissions), seed_live_demo.py (a demo viva)
├── config.yaml              AI thresholds and score weights
├── pyproject.toml / uv.lock Dependencies (exact versions locked)
└── .env.example             Example settings
```

---

## 3. The layers, and the life of one request

```
 HTTP request
     │
     ▼
 routes/        "Which address?"      Thin: read the input, call ONE service function, return its result
     │  deps.py runs first: open a database session, read the token, load the user
     ▼
 services/      "Is this allowed?"    All decisions: permissions, deadlines, scheduling, statistics
     │
     ▼
 models/        "What is stored?"     Tables, read and written through SQLAlchemy
     │
     ▼
 schemas/       "What goes out?"      The response is built as a schema, converted to camelCase JSON
```

Example — `POST /api/vivas/{id}/join` (a student opens a viva):

| # | Where | What happens |
|---|---|---|
| 1 | `routes/vivas.py` → `join_viva(viva_id, user, db)` | FastAPI matches the path |
| 2 | `deps.py` → `DbSession` | Opens a database session for this request (closed afterwards) |
| 3 | `deps.py` → `RegisteredUser` | Reads `Authorization: Bearer …`, checks the signature and expiry, loads the user, checks they chose a role. Otherwise `401` / `403` |
| 4 | `services/vivas.py` → `join()` | Viva exists, is scheduled, and this student is assigned? Else `404`. Already joined? Fine. Otherwise works out **their** slot window; too early → `400`; too late → `403` "marked as not on time"; inside → saves a `VivaAttempt` |
| 5 | Response | `{ "vivaId", "joinedAt", "endsAt" }` as JSON |

**Why layers?** Every rule lives in one place (`services/`), so it's easy to find, test and change. Routes
contain no rules; models contain no decisions.

### Dependencies (`api/deps.py`)

A FastAPI *dependency* is something declared as a parameter that FastAPI prepares before the function runs:

| Parameter type | Gives | Fails with |
|---|---|---|
| `DbSession` | A database session | — |
| `CurrentUser` | The signed-in user (role may be unset) | `401` no/expired token |
| `RegisteredUser` | A signed-in user who has chosen a role | `403` "Finish registration…" |

---

## 4. Permissions (the core rule helpers)

In `services/classes.py`:

| Helper | Returns / does |
|---|---|
| `role_in(db, cls, user)` | `"owner"`, `"ta"`, `"student"` or `None` |
| `get_managed_class(db, id, user)` | The class if you're owner or TA, else `404` (not `403`, so outsiders can't tell it exists) |
| `get_owned_class(db, id, user)` | The class if you're the owner; TAs get `403` (used for managing TAs) |
| `is_member(db, class_id, user_id)` | A student of the class (joined, and not a TA of it) |

Every service starts with one of these. That's the whole permission system: **owner ⊃ TA ⊃ student**, per
class.

---

## 5. The rules, area by area

### 5.1 Accounts (`services/users.py`)

- Email is trimmed and lower-cased; personal domains (gmail.com…) are rejected (`blocked_email_domains`); an
  optional allow-list (`allowed_email_domains`, e.g. `["iisc.ac.in"]`) can restrict sign-in to one institute.
- An existing email signs in as that user; a new one is created with no role.
- The role is chosen once; changing it later → `409`.

### 5.2 Classes and TAs (`services/classes.py`)

- Only instructors create classes. A 6-character join code is drawn from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  (no 0/O or 1/I) with Python's secure random generator, retrying if taken.
- You can't join your own class, join twice, or join as a TA of it.
- The owner adds TAs by searching registered users (3+ characters of email/name). A student who becomes a TA
  stops counting as a student.

### 5.3 Assignments (`services/assignments.py`)

- Staff set title, instructions, deadline, optional total marks.
- A student may submit any number of times **until the deadline** (then `403`), keeping chosen earlier files,
  up to 20 files and 10 GitHub links.
- Status per student: **missing** (nothing), **submitted** (before the deadline), **late** (after — only
  possible if the deadline was moved earlier).
- Staff return work with marks (graded assignments), feedback and files; students see it once returned.

### 5.4 Files (`services/files.py`, `core/storage.py`)

- Allowed extensions depend on the kind of file (e.g. class material: pdf/txt/md/docx/pptx). Max size
  `MAX_UPLOAD_MB` (15 MB). Saved as `uploads/<class id>/<kind>/<random name>`.
- Staff can download any file in the class. Students can download their own uploads, class material, and
  feedback files returned to them — nothing else.
- Staff can delete staff uploads; student submissions can't be deleted.

### 5.5 Vivas (`services/vivas.py`)

**Phase** is worked out from the status and the clock, not stored:

```
draft ──schedule──► upcoming ──start time──► live ──end time──► closed
  ▲                     │
  └────unschedule───────┘          (setup can only be changed while draft or upcoming)
```

**Scheduling checks** (`_check_ready`): instructions (text or a file), at least one criterion, a report format,
a start time in the future, at least one student (for "selected" vivas), conductor = staff (AI isn't built yet),
at least one examiner, and **every student allocated**.

**Allocation** (`_set_allocation`): examiners must be the owner or TAs; allocated students must be taking the
viva; each student once. The order in the request is each examiner's queue order (`position`).

**Times:**

| | Formula |
|---|---|
| Slot start | `starts_at + position × (duration + break)` |
| Entry window | slot start → slot start + 5 min (`VIVA_JOIN_WINDOW_MINUTES`) |
| Viva end (`ends_at`) | last slot start + 5 min + duration |

**Student status** (`_student_status`): *upcoming* → *open* (inside their window) → *in progress* (joined; until
the examiner ends it) → *attended*; or *missed* if the window passed without joining.

**Statistics** (`stats`): per student — resume status (from the linked assignment), viva status, examiner, slot,
session status, score, risk, mastery, flags, feedback; for the class — counts, average score, per-criterion
averages, flag counts by type.

### 5.6 Live sessions (`services/live.py`)

- `connect`: who may open the live-room WebSocket (the joined student; their examiner; the class owner). Creates
  the `viva_sessions` row the first time.
- `queue`: an examiner's students in slot order, with "online now" from the in-memory room.
- `report`: everything for the report, including the AI's suggested per-criterion scores (averaged over graded
  answers).
- `save_result`: only after the interview ended; criteria must be the viva's own.
- `purge_old_snapshots`: deletes flag snapshots older than `SNAPSHOT_RETENTION_DAYS` (run at startup).

---

## 6. Errors and JSON style

- Services raise errors from `core/errors.py`; one handler in `main.py` turns them into
  `{"detail": "message"}` with the right status (400/401/403/404/409).
- Schemas inherit from `ApiModel` (`schemas/base.py`), which converts `snake_case` ↔ `camelCase` and can be built
  straight from database objects.

---

## 7. Settings (`backend/.env`)

All optional; defaults work for local development. Full list with comments in `.env.example`.

| Setting | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | Where the database is | `sqlite:///./viva.db` |
| `CORS_ORIGINS` | Website addresses allowed to call the API | `localhost:3000`, `127.0.0.1:3000` |
| `JWT_SECRET` | Secret for signing tokens — **must be long and random outside dev** | a dev value |
| `ACCESS_TOKEN_MINUTES` | Token lifetime | 1440 (24 h) |
| `AUTH_MODE` | `dev` (allows developer sign-in) or `microsoft` | `dev` |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `ALLOWED_EMAIL_DOMAINS` | Microsoft sign-in | off |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | File storage | `./uploads`, 15 |
| `VIVA_JOIN_WINDOW_MINUTES` | Strict entry window | 5 |
| `ANTHROPIC_API_KEY`, `LLM_MODEL`, `LLM_EFFORT` | Claude for grading/Co-Pilot | none, `claude-sonnet-5-5`, `medium` |
| `WHISPER_MODEL`, `ML_DEVICE` | Speech-to-text size; `auto` / `cpu` / `cuda` | `base.en`, `auto` |
| `LIVE_CONFIG_FILE`, `SNAPSHOT_RETENTION_DAYS`, `LIVE_WARM_UP` | AI thresholds file; snapshot retention; load models at startup | `./config.yaml`, 30, on |

Settings are read once by `core/config.py` (`get_settings()`), using *pydantic-settings*.

---

## 8. Tests

`uv run pytest` runs 88 tests. Each test gets a **fresh in-memory database** and a temporary upload folder
(`tests/conftest.py`), so your real data is never touched. The AI models are switched off in tests and the LLM is
replaced by a fake that returns fixed answers.

| File | Covers |
|---|---|
| `test_auth.py`, `test_microsoft_login.py` | Sign-in, roles, email rules, Microsoft token checks |
| `test_classes.py`, `test_tas.py` | Classes, join codes, visibility, TAs |
| `test_assignments.py` | Deadlines, submissions, statuses, grading, file permissions |
| `test_vivas.py` | Setup, scheduling checks, entry window, student view, feedback, stats |
| `test_allocation.py` | Examiners, parallel slot times, reordering, validation, per-slot entry, queues |
| `test_live.py` | The live-room WebSocket end to end, results, grading + mastery, every integrity rule, delivery metrics |
