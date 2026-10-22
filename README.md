# AI Viva & Proctoring System

Browser-based AI oral exams: adaptive questions from the course, the student's resume and their GitHub projects, honest understanding reports, and webcam proctoring.

- **Spec & roadmap:** [SPEC.md](SPEC.md)
- **Frontend:** [frontend/](frontend/README.md) — Next.js
- **Backend:** [backend/](backend/README.md) — FastAPI
- **Docs:** [docs/](docs/) — plain-language guides to how each part works

## Run locally
Two terminals:

```bash
# 1. Backend  → http://localhost:8000/docs
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

```bash
# 2. Frontend → http://localhost:3000
cd frontend
npm install
npm run dev
```
