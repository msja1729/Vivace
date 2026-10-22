# SPEC — AI Viva & Proctoring System

## 1. Goal
A browser-based system where students take an **oral (viva) exam** in parallel sessions. An AI asks questions —    from the course **and from the student's own resume and projects** — scores answers on **real understanding** (not keywords), asks **follow-up probes** when answers are shallow, and **proctors** the student through the webcam. Each student gets an **honest overall report** of their understanding.

## 2. Users
| Role | Can do |
|---|---|
| **Instructor** | Create exams, set questions/rubrics, upload course material, choose question sources, view results, reports & flags |
| **Student** | Log in, upload resume + GitHub project links, run a device check, take the viva, share screen to walk through a project |

## 3. Core Features
1. **Exam Setup** — Instructor defines topics, question format, number of questions, difficulty, time limit, and a scoring rubric. Uploads course material (PDF/text). Chooses the question mix: **course / resume / project** (e.g. 50 / 20 / 30%).
2. **Student Profile Upload** — Before the exam, each student uploads:
   - **Resume** (PDF) — skills, internships, coursework claimed.
   - **GitHub repo links** of their projects (public, or access granted).
3. **Project Deep-Dive** — The AI questions the student on their own work:
   - **Repo analysis (before exam):** the backend clones each repo, reads README, structure and key files, and builds a project summary (stack, architecture, main modules, notable design choices).
   - **Live walkthrough (during exam):** the student **shares their screen** and explains the project while the AI sees the screen frames + hears the explanation, and asks questions about what is shown.
   - **Question quality:** questions must test both **depth** (why this design? what breaks if X changes? how does this function work?) and **breadth** (alternatives, trade-offs, related concepts, scaling, testing). No generic or trivia questions. Questions are grounded in specific files/claims from the repo and resume.
4. **Parallel Sessions** — Many students take exams at the same time, each with an independent live session.
5. **Adaptive Semantic Scoring** — Speech → transcript → LLM scores the answer against rubric + course material / repo context. Shallow answers trigger a follow-up probe question.
6. **Proctoring** — Flags looking away, face missing, multiple people, phones in frame, tab switches.
7. **Behaviour Analysis** *(stretch)* — Classifies signals like nervous / confident / confused. Reported only; never affects the score.
8. **Report** — Per student:
   - Score, per-question feedback, transcript, and a timeline of proctoring flags.
   - **Overall Understanding Review** — a written assessment of how well the student understands the concepts and their own projects.
     - **Honest:** states gaps plainly; no inflated praise or softened verdicts.
     - **Evidence-based:** every claim backed by a quote from the transcript or a reference to the repo.
     - **Structured:** per-concept level (*strong / partial / weak / not demonstrated*), strengths, gaps, **resume/project claims vs. demonstrated knowledge** (e.g. "claims X on resume, could not explain Y"), and concrete next steps.
     - Says "insufficient evidence" when a concept wasn't tested enough, instead of guessing.

## 4. Tech Stack
| Layer | Tech |
|---|---|
| Frontend | Next.js (React), TypeScript, Tailwind, WebRTC (`getUserMedia`, `getDisplayMedia` for screen share) |
| Backend | FastAPI, WebSockets |
| Background jobs | Celery + Redis |
| Database | PostgreSQL (or SQLite for dev) |
| File storage | Local disk (dev) / S3-compatible (prod) for resumes, snapshots |
| Speech-to-text | Whisper (`faster-whisper`) |
| LLM | Claude API (vision-capable, for screen frames) — swappable with a local model via Ollama |
| RAG | Embeddings + vector store (ChromaDB / FAISS) over course material, resume, repo files |
| Repo analysis | GitHub API + `git clone`, file filtering (skip binaries, `node_modules`, etc.) |
| Resume parsing | `pdfplumber` / PyMuPDF → LLM extraction to structured JSON |
| Vision (proctoring) | OpenCV, MediaPipe Face Mesh, YOLOv8-nano |
| Behaviour model | scikit-learn (Random Forest / XGBoost) |

## 5. System Flow
```
BEFORE EXAM
Student uploads resume + repo links ──► Celery: parse resume, clone & summarise repos ──► vector store + profile

DURING EXAM
Student browser ──WebSocket──► FastAPI session
   │  audio chunks (per answer)              │──► Celery: Whisper → transcript → LLM scorer (+RAG)
   │  webcam frames (2–3 fps, JPEG)          │──► Celery: MediaPipe + YOLO → proctoring flags
   │  screen frames (~1 fps, walkthrough)    │──► LLM (vision) + repo context → project questions
   ◄── next question / probe ────────────────┘

AFTER EXAM
All answers + flags ──► LLM: Overall Understanding Review ──► PostgreSQL ──► Instructor dashboard
```

## 6. Viva Logic (per question)
1. Server picks the next question source (course / resume / project) per the exam mix.
2. Question is generated or selected, grounded in rubric, course chunks, resume, or repo files.
3. Student answers aloud; audio sent when they click **Done** (or after silence).
4. Whisper transcribes.
5. LLM receives: question, rubric, retrieved context, transcript → returns JSON:
   `{ score: 0–10, depth: shallow|adequate|deep, concepts: [...], feedback, probe_question | null }`
6. If `depth = shallow` and probes used < 2 → ask the probe. Otherwise → next question.
7. Final score = weighted average of question scores (probes refine their parent question's score).

**Project walkthrough segment:** student shares screen and explains → AI watches screen frames + transcript → asks 3–5 targeted questions about the code/design shown → scored like any other answer.

## 7. Proctoring Rules (initial)
| Check | Flag when |
|---|---|
| Gaze / head pose | Off-screen for > 3 s continuously (relaxed during screen-share walkthrough) |
| Face missing | No face for > 2 s |
| Multiple faces | > 1 face detected |
| Phone / object | YOLO detects `cell phone` / `book` with conf > 0.5 |
| Tab switch | Browser `visibilitychange` event (ignored during screen-share walkthrough) |

Flags are **evidence for the instructor to review**, not automatic failure.

## 8. Data Model (minimal)
- `User(id, name, role)`
- `Exam(id, title, rubric, settings, question_mix, material_ids)`
- `Question(id, exam_id, text, topic, difficulty, source: course|resume|project)`
- `StudentProfile(id, student_id, exam_id, resume_path, resume_json, repo_urls, repo_summaries)`
- `Session(id, exam_id, student_id, status, started_at, ended_at)`
- `Answer(id, session_id, question_id, transcript, score, depth, concepts, feedback, is_probe)`
- `Flag(id, session_id, type, timestamp, confidence, snapshot_path)`
- `Report(id, session_id, overall_score, concept_levels, strengths, gaps, claims_vs_demonstrated, next_steps, summary)`

## 9. Timeline (Build Order)
| Phase | Weeks | Deliverable |
|---|---|---|
| **0. Setup** | 0.5 | Repo structure, FastAPI + Next.js skeletons, DB, Docker Compose (Redis/Postgres) |
| **1. Frontend & Capture** | 2 | Login, instructor exam-setup form, student resume + repo upload page, device check, webcam/mic capture, screen share, audio recording + frame sampling |
| **2. Backend & Sessions** | 1.5 | Auth, exam CRUD + upload APIs, WebSocket session handler, Celery workers; test 5+ simultaneous sessions |
| **3. Viva Engine** | 2 | Whisper STT, RAG over course material, LLM scoring + JSON output, probe-question loop |
| **4. Resume & Project Analysis** | 1.5 | Resume parsing, repo clone + summarisation, project-grounded question generation, screen-share walkthrough questioning |
| **5. Proctoring** | 1.5 | MediaPipe gaze/head pose, face count, YOLO detection, tab-switch events, flag storage |
| **6. Reports & Dashboard** | 1 | Overall Understanding Review generation, results page: scores, review, transcript, flag timeline |
| **7. Behaviour Analysis** *(stretch)* | 1 | Small labelled dataset, landmark-variance features, train classifier |
| **8. Testing & Polish** | 1 | Load test, scoring accuracy vs. human grades, review honesty check, bug fixes, demo + docs |

**Total: ~12 weeks** (≈ 11 without the stretch phase)

## 10. Success Criteria
- ≥ 10 concurrent sessions without lag or dropped data.
- LLM scores within ±1.5 of a human grader on ≥ 80% of test answers.
- Probe questions triggered for clearly shallow answers.
- Project questions reference specific files/decisions from the repo (manual check on ≥ 5 real repos).
- Overall review flags gaps that a human examiner agrees with; every claim cites evidence.
- Proctoring detects phone / second person / looking away in a scripted test video.
- End-to-end transcription + scoring latency < 10 s per answer.

## 11. Out of Scope (for now)
- Mobile app, live human proctor view, plagiarism checking, multi-language support, private repos on non-GitHub hosts.

## 12. Repo Structure & Conventions
```
project/
├── README.md                # what it is, how to run, links to docs
├── SPEC.md                  # this file
├── docker-compose.yml
├── .env.example             # all required env vars, no secrets
├── docs/                    # architecture notes, API reference, decisions
├── frontend/                # Next.js app
│   └── src/
│       ├── app/             # routes: (auth), instructor/, student/, exam/
│       ├── components/      # reusable UI (ui/, exam/, media/)
│       ├── hooks/           # useMediaCapture, useScreenShare, useExamSocket
│       ├── lib/             # API client, websocket client, utils
│       └── types/           # shared TypeScript types
├── backend/
│   ├── app/
│   │   ├── api/             # FastAPI routers (auth, exams, uploads, sessions)
│   │   ├── ws/              # websocket session handlers
│   │   ├── models/          # DB models
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   └── core/            # config, db, security
│   ├── workers/             # Celery tasks: stt, scoring, vision, repo_analysis, report
│   ├── ml/
│   │   ├── prompts/         # LLM prompts (one file per prompt)
│   │   ├── rag/             # embeddings, retrieval
│   │   ├── vision/          # proctoring models
│   │   └── behaviour/       # behaviour classifier (stretch)
│   └── tests/
└── data/                    # sample course material, test recordings (git-ignored if large)
```

**Conventions**
- One responsibility per folder/file; names say what the thing does.
- Each top-level folder (`frontend/`, `backend/`, `docs/`) has a short README.
- Config via `.env` only; never commit secrets.
- Formatting/linting: Prettier + ESLint (frontend), Ruff + Black (backend).
- Commits: small and descriptive (`feat:`, `fix:`, `docs:` prefixes).
