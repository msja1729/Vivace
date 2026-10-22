# Frontend

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4. Flat dark design based on `UI2.jpeg`.

## Run
```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build
```

## Layout
| Path | What's there |
|---|---|
| `src/app/(public)/` | Landing and register pages (top navbar) |
| `src/app/(app)/` | Signed-in pages with the common sidebar: `dashboard/`, `classes/create`, `classes/join`, and inside a class `classes/[classId]/` → `members`, `assignments` (+ `new`, `[assignmentId]`), `vivas` (+ `[vivaId]` with Summary statistics / Setup tabs), `files` |
| `src/components/ui/` | Reusable building blocks (Button, Card/Section, form fields, Badge, StatTile, icons) |
| `src/components/layout/` | `AppShell` + `Sidebar` (signed in), Navbar + Footer (public) |
| `src/components/classes/`, `assignments/`, `vivas/`, `files/` | Pieces for each class section (e.g. `VivaSetupForm`, `VivaStatsPanel`) |
| `src/components/auth/` | Microsoft sign-in, role picker, `RequireAuth` page guard |
| `src/components/dashboard/` | Dashboard action cards and class lists |
| `src/lib/auth/` | Login state (`AuthProvider`, `session.ts`) and Microsoft sign-in |
| `src/lib/api/` | Calls to the FastAPI backend (`client.ts` = fetch wrapper + file download, `classes.ts`, `assignments.ts`, `vivas.ts`, `files.ts`) |
| `src/lib/workspace.tsx` | The user's classes and the class in the URL, shared by the sidebar and pages |
| `src/lib/useLoad.ts`, `src/lib/format.ts` | Data-loading hook; date / size formatting |
| `src/config/site.ts` | App name and nav links |
| `src/types/` | Shared TypeScript types |

## Backend
Needs the backend running (see `../backend/README.md`). Its URL is set by `NEXT_PUBLIC_API_URL` (copy `.env.example` to `.env.local`; default `http://localhost:8000/api`).

## Sign-in
`src/lib/auth/microsoft.ts` signs in with Microsoft (MSAL redirect flow) when `NEXT_PUBLIC_AZURE_CLIENT_ID` is set in `.env.local` (see `.env.example` and the backend README). Without it, the register page shows a developer sign-in (name + email) for local testing.

## Students vs staff
Class pages show the staff view (owner and TAs) or the student view based on `cls.myRole`. Student views live in `src/components/student/`.

A beginner-friendly walkthrough is in [`../docs/FRONTEND_EXPLAINED.md`](../docs/FRONTEND_EXPLAINED.md).
