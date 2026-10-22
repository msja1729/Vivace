# Running, Testing, and Deploying

How to start the app on your laptop, try it with demo data, run the tests, fix common problems — and what it
would take to put it online later.

---

## 1. One-time setup

You need **Python 3.12 + uv** (backend) and **Node.js** (frontend).

```bash
# Backend
cd backend
uv sync --extra live          # Python packages incl. the AI libraries (~3 GB, takes a while)
uv run alembic upgrade head   # create the database tables in viva.db

# Frontend
cd ../frontend
npm install                   # JavaScript packages
```

Optional settings:
- `backend/.env` (copy `.env.example`): e.g. `ANTHROPIC_API_KEY=…` to turn on AI grading and the Co-Pilot.
- `frontend/.env.local` (copy `.env.example`): the backend address and Microsoft sign-in IDs.

Without any settings, the defaults work for local use.

---

## 2. Starting the app (two terminals)

| Terminal 1 — backend | Terminal 2 — frontend |
|---|---|
| `cd backend` | `cd frontend` |
| `uv run uvicorn app.main:app --reload --port 8000` | `npm run dev` |

Then open **http://localhost:3000**.

- `--reload` restarts the backend when you save a Python file. The frontend reloads on its own.
- The first backend start downloads and loads the AI models (about a minute). The log shows
  `Application startup complete` straight away; the models finish loading in the background.
- Useful addresses: http://localhost:8000/api/health (is the backend up?), http://localhost:8000/docs (try every
  endpoint by hand).

To stop: `Ctrl + C` in each terminal.

---

## 3. Trying it out

### 3.1 Two people on one laptop

Each **website address** has its own browser storage, so you can be signed in as two people at once:

| Window | Address | Sign in as |
|---|---|---|
| 1 | http://localhost:3000 | the instructor |
| 2 | http://127.0.0.1:3000 | a student |

(This avoids needing an Incognito window, which didn't sign in during our first test; the cause wasn't
pinned down.)

Developer sign-in accepts any **name + school-style email** (`.edu`, `.ac.in`…). Personal domains (gmail …)
and fake test domains (`.test`, `.local`) are rejected.

### 3.2 Demo data

```bash
cd backend
uv run python -m scripts.seed_demo <JOIN_CODE>          # 8 demo students + resume submissions
uv run python -m scripts.seed_live_demo <JOIN_CODE> 5   # a staff-run viva starting in 5 minutes,
                                                        # split between the instructor and a demo TA
```

The second script prints each student's slot time and examiner. Demo students sign in as `demo1@demo-school.edu`
… `demo8@demo-school.edu`; the demo TA as `demo-ta@demo-school.edu`.

### 3.3 Testing a viva alone

Both windows use the same microphone, so:

1. In the examiner console, click **Mute mic**.
2. Ask questions by **typing** them and clicking **Show**.
3. Answer **out loud** as the student.
4. Try the flags: look away for 5 s, turn your head, hold up a phone, leave the frame, get someone else in view.

Use headphones to avoid echo.

---

## 4. Tests and checks

```bash
cd backend
uv run pytest                 # 88 tests, ~20 s. Uses a throwaway in-memory database; your data is safe
uv run ruff check .           # code mistakes
uv run ruff format .          # tidy layout

cd ../frontend
npm run lint                  # code mistakes
npx tsc --noEmit              # type errors
npm run build                 # full production build
```

---

## 5. Common problems

| Symptom | Cause | Fix |
|---|---|---|
| "Can't reach the server. Is the backend running?" | Backend not started, or crashed | Start it (terminal 1); read its last error |
| Sign-in page is blank on `127.0.0.1:3000` | The dev server blocks that address unless allowed | Already allowed in `next.config.ts` (`allowedDevOrigins`). Restart `npm run dev` if you changed it |
| Mic level bar doesn't move; can't continue | The browser picked a **silent virtual microphone** (e.g. SteelSeries Sonar, OBS, Discord, voice changers) | Choose your real microphone in the **Microphone** dropdown on the device-check screen. Or set the right default in Windows sound settings |
| "Camera and microphone access was blocked" | Permission denied | Click the camera icon in the address bar → Allow, then retry |
| Camera works on `localhost` but not from another computer | Browsers only allow camera/mic on **HTTPS** or `localhost` | Needs HTTPS (see section 7) |
| Student can't join: "Entry closed" | More than 5 minutes after **their** slot | Reschedule (or run `seed_live_demo` again for a fresh demo viva) |
| Student can't join: "You haven't been given a time slot" | They aren't allocated to an examiner | Setup → Examiners & allocation |
| Co-Pilot / grades say "Claude API key missing" | No `ANTHROPIC_API_KEY` | Put it in `backend/.env`, restart the backend |
| "Face, gaze & head pose: off" (or another engine) | That model failed to load | Check the backend log for the reason (`… unavailable: …`); often a download problem — restart to retry |
| Video never connects between two different networks | Strict network blocks direct connections; no TURN server is configured | Same network works; for real use add a TURN server |
| `Another next dev server is already running` | An old frontend process is still running | Close it (the message prints its PID: `taskkill /PID <pid> /F`) |
| Port 8000 already in use | An old backend is still running | Close that terminal or end the `python`/`uvicorn` process |

To **start fresh** (wipe all data): see [DATABASE_AND_FILES.md](DATABASE_AND_FILES.md#5-starting-fresh).

---

## 6. Branches (planned)

The plan discussed is two git branches:

| Branch | Purpose |
|---|---|
| `dev` | Day-to-day development and testing. New features land here first |
| `main` | Releases only. Merge `dev` into `main` when a version is tested and ready; the live deployment would run `main` |

(The project isn't a git repository yet; this will be set up when you decide.)

---

## 7. What deploying would involve (for later)

**Deploying** means running the app on a machine that is always on, at a public **HTTPS** address, so people can
use it from anywhere. Things to know:

- **GitHub Pages can't host it.** It only serves fixed files; this app needs a running backend (logins,
  database, live rooms, AI).
- **The backend needs a real computer** with about **8–16 GB of memory** for the AI models (more students at once
  → more CPU, or a GPU).
- **HTTPS is required** for the camera and microphone off `localhost`.
- **A TURN server** keeps video working on strict networks.
- **Microsoft sign-in** should replace the developer sign-in, so only real school accounts can log in.

A typical setup:

| Part | Where | Cost |
|---|---|---|
| Code, branches | GitHub | Free |
| Frontend | Vercel (made for Next.js; deploys automatically from `main`, with a test link for `dev`) | Free |
| Backend + database + files | A cloud machine (Azure for Students credit with an IISc email, Oracle Cloud free tier) or an institute/lab server | Free credit or ~$60/month always-on |
| TURN relay | A free tier (e.g. Metered, Cloudflare) | Free |
| HTTPS certificate | Let's Encrypt (automatic) | Free |

For a short test with real students before a full deployment, an **HTTPS tunnel** (e.g. Cloudflare Tunnel) can
give your laptop a temporary public HTTPS link while it runs.
