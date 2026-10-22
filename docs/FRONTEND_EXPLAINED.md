# How the Frontend Works

The **frontend** (`frontend/`) is the website: every page, button and form, and the code that runs in each
person's browser. It never stores data itself — it asks the backend (see
[API_AND_COMMUNICATION.md](API_AND_COMMUNICATION.md)) and shows the answers.

New terms are explained the first time they appear. The overview is in [EXPLANATION.md](EXPLANATION.md).

---

## 1. Tools

| Tool | What it is | What it does here |
|---|---|---|
| **Next.js 16** | A framework (ready-made structure) for websites built with React | Pages and URLs, building and serving the site. *Note:* version 16 differs from older tutorials; its own docs are in `node_modules/next/dist/docs/` |
| **React 19** | A library for building screens from reusable pieces called **components** | Every button, card and page is a component |
| **TypeScript** | JavaScript plus **types** (labels saying what shape data must have) | Catches mistakes before the code runs |
| **Tailwind CSS 4** | Styling with short class names like `p-4` (padding) or `text-muted` | All the visual design |
| **MSAL** (`@azure/msal-browser`) | Microsoft's sign-in library | "Sign in with Microsoft", once the Azure IDs are set |
| **Browser APIs** | Features built into every browser | `getUserMedia` (camera/mic), `WebSocket`, `RTCPeerConnection` (WebRTC), `AudioWorklet` (audio processing), `localStorage` |
| **ESLint** | A checker for common code mistakes | `npm run lint` |

### React in five ideas

- **Component**: a function that returns a piece of screen. `<Button>` is one; a whole page is one too.
- **Props**: the inputs you give a component: `<Badge tone="success">Live</Badge>`.
- **State** (`useState`): a value a component remembers that can change (what's typed in a box, whether
  something is loading). Changing it redraws the component.
- **Effect** (`useEffect`): code that runs after the component appears — loading data, opening a WebSocket,
  starting the camera — with a clean-up when it goes away.
- **Context**: a way to share one value with every component below it without passing it by hand (used for
  "who is signed in" and "which class am I in").

`"use client"` at the top of a file means "this runs in the browser" (it uses state, clicks, the camera…).
Almost every file here has it, because signed-in data lives in the browser's storage.

---

## 2. Folders become URLs

Next.js uses **file-based routing**: a folder with a `page.tsx` inside `src/app/` is a page at that address.
Folders in brackets like `[classId]` are **dynamic**: they match any value, which the page reads with
`useParams()`. Folders in parentheses like `(app)` only group pages; they don't appear in the URL.

| File (under `src/app/`) | URL | Shows |
|---|---|---|
| `(public)/page.tsx` | `/` | Landing page |
| `(public)/register/page.tsx` | `/register` | Sign in, then choose a role |
| `(app)/dashboard/page.tsx` | `/dashboard` | Home: action cards and your classes |
| `(app)/classes/create/page.tsx` | `/classes/create` | Create a class (instructors) |
| `(app)/classes/join/page.tsx` | `/classes/join` | Join with a code |
| `(app)/classes/[classId]/page.tsx` | `/classes/<id>` | Class overview |
| `…/[classId]/members/page.tsx` | `…/members` | Students, TAs and the join code (staff) |
| `…/[classId]/files/page.tsx` | `…/files` | Class files |
| `…/[classId]/assignments/page.tsx` | `…/assignments` | Assignments list |
| `…/[classId]/assignments/new/page.tsx` | `…/assignments/new` | New assignment (staff) |
| `…/[classId]/assignments/[assignmentId]/page.tsx` | `…/assignments/<id>` | Staff: roster and grading. Student: own submission |
| `…/[classId]/vivas/page.tsx` | `…/vivas` | Vivas list |
| `…/[classId]/vivas/[vivaId]/page.tsx` | `…/vivas/<id>` | Staff: tabs **Live room / Summary statistics / Setup**. Student: their viva page (and live room) |
| `…/vivas/[vivaId]/room/[studentId]/page.tsx` | `…/room/<student id>` | Examiner's live console for one student |
| `…/vivas/[vivaId]/report/[sessionId]/page.tsx` | `…/report/<session id>` | One student's printable report |

Many pages show **different screens to staff and students** from the same URL: the page asks
`isStaff(cls)` and renders, for example, `<VivaWorkspace>` for staff or `<StudentVivaDetail>` for students.

### Layouts: the frame around pages

A `layout.tsx` wraps every page below it.

| Layout | Adds |
|---|---|
| `app/layout.tsx` | The font, global CSS, and `AuthProvider` (who is signed in) around everything |
| `app/(public)/layout.tsx` | Top navbar + footer for signed-out pages |
| `app/(app)/layout.tsx` → `AppShell` | For signed-in pages: `RequireAuth` (sends signed-out people to `/register`), `WorkspaceProvider` (your classes + the current class), and the **sidebar** |

---

## 3. Folder structure

```
frontend/src/
├── app/                 Pages and layouts (section 2). globals.css = colours, glass panels, print styles
├── components/
│   ├── ui/              Basic pieces used everywhere: Button, Card/Section, Field (inputs), Badge,
│   │                    StatTile, Avatar, Icons, ConfirmButton, SearchInput, Logo
│   ├── layout/          AppShell, Sidebar, Navbar, Footer
│   ├── auth/            MicrosoftSignIn (+ developer sign-in form), RoleSelector, RequireAuth
│   ├── dashboard/       ActionCard, ClassList
│   ├── classes/         ClassPage (loads the class, handles "not found"), JoinCode, TeachingStaff
│   ├── files/           FileChip (download link), FilePicker (choose files to upload)
│   ├── assignments/     AssignmentForm, GradePanel, SubmissionProgress
│   ├── vivas/           VivaSetupForm, AllocationEditor, VivaStatsPanel, PhaseBadge, options (texts/templates)
│   ├── live/            ExaminerQueue, ExaminerConsole, StudentLiveRoom, SessionReportView, LiveParts
│   └── student/         The student versions: StudentAssignments, StudentVivas, StudentVivaDetail, StudentFiles …
├── lib/
│   ├── api/             One file per area of the backend: client.ts (the fetch wrapper), classes.ts,
│   │                    assignments.ts, files.ts, vivas.ts
│   ├── auth/            AuthProvider.tsx, session.ts (localStorage), microsoft.ts (MSAL + dev sign-in)
│   ├── live/            room.ts (WebSocket + WebRTC), media.ts (camera/mic, frames, audio streaming)
│   ├── workspace.tsx    Current class + my classes, shared with the sidebar and pages
│   ├── useLoad.ts       "Load this from the API when the key changes"
│   ├── useNow.ts        A ticking clock for countdowns
│   └── format.ts        Dates, file sizes, initials
├── config/site.ts       The app name and tagline (change the name here)
└── types/index.ts       Every data shape (User, ClassRoom, Viva, SessionReport …) — mirrors the backend's JSON
```

**Why this split:** pages stay thin (they arrange components); components don't know *how* data is fetched;
`lib/` is the only place that talks to the server. Changing an endpoint touches one function in `lib/api/`.
The `@/` in imports means `src/`.

---

## 4. Signing in and staying signed in

### Sign-in screen (`/register`)

- `components/auth/MicrosoftSignIn.tsx` shows **"Sign in with Microsoft"** if `NEXT_PUBLIC_AZURE_CLIENT_ID` is
  set, otherwise the **developer sign-in** form (name + school email).
- The form rejects personal email domains in the browser (the backend checks again), calls
  `POST /api/auth/dev-login`, and stores the result.
- New users then pick **Student** or **Instructor** (`RoleSelector` → `PUT /api/users/me/role`).

### Remembering the session (`lib/auth/`)

- `session.ts` keeps `{ token, user }` in **localStorage** (a small storage area in each browser, per website
  address) under the key `viva.session`. It survives reloads.
- `AuthProvider.tsx` makes it available to every component through `useAuth()` → `{ user, loading,
  completeSignIn, setRole, signOut }`. It uses `useSyncExternalStore` so every component updates the moment the
  session changes — even in another tab.
- Because storage is per **address**, `http://localhost:3000` and `http://127.0.0.1:3000` have separate
  sessions. That's how one laptop can be signed in as two people at once for testing.

### The page guard

`RequireAuth` (inside `AppShell`) sends anyone without a session or role to `/register`. `ClassPage` shows
"Class not found" when the backend says you're not in the class, and with `instructorOnly` keeps students out
of staff pages. These are conveniences; the **backend** is what really enforces access.

---

## 5. Loading and saving data

### `lib/api/client.ts` — the one door to the server

Every call goes through `api(path, { method, body })`, which:

| Job | How |
|---|---|
| Finds the server | `NEXT_PUBLIC_API_URL`, default `http://localhost:8000/api` |
| Sends the data | JSON for objects; multipart for `FormData` (file uploads) |
| Proves who you are | Adds `Authorization: Bearer <token>` |
| Reports errors | Turns `{"detail": "…"}` into an `ApiError` with that message |
| Handles expiry | On `401`, clears the session (you're sent to sign in) |
| Handles no server | "Can't reach the server. Is the backend running?" |

`lib/api/vivas.ts` etc. wrap it into named functions, e.g.

```ts
export function joinViva(id: string) {
  return api(`/vivas/${id}/join`, { method: "POST" });
}
```

### `useLoad` — the loading pattern used by pages

```ts
const { data, error, reload, setData } = useLoad(() => getViva(vivaId), vivaId);
```

`data` is `undefined` while loading (show a spinner), then the result. `reload()` fetches again (the examiner
queue does this every 10 s). `setData()` shows a save's response without fetching again.

### `workspace.tsx` — the current class

Loads "my classes" for the sidebar and the class in the URL once, and shares them, so pages don't each fetch
the class again.

---

## 6. Feature walkthroughs

### 6.1 Classes, members, TAs, files

- **Create** (`/classes/create`) → `POST /api/classes` → shows the join code.
- **Join** (`/classes/join`) → upper-cases the code → `POST /api/classes/join`.
- **Members** (`TeachingStaff`, `JoinCode`): owner searches registered users by email and adds them as TAs.
- **Files**: staff upload class material (`FilePicker` → multipart upload); students see only material.
  Downloads go through `downloadFile()` because they need the token.

### 6.2 Assignments

- Staff: `AssignmentForm` (title, instructions, deadline, optional marks). The detail page shows each student as
  submitted / late / missing with their files; `GradePanel` returns marks, feedback and files.
- Students (`components/student/StudentAssignment*.tsx`): upload any files plus GitHub links and a note, and
  re-submit until the deadline; then see returned marks and feedback.

### 6.3 Viva setup (`components/vivas/VivaSetupForm.tsx`)

One long form, saved as a draft until you click "Schedule viva":

| Section | What it sets |
|---|---|
| **Who conducts the viva** (`ConductorPicker`) | "Instructor & TAs" (live) or "AI examiner" (shown as coming soon) |
| **Basics & schedule** | Title, which assignment's submissions the AI reads, start time, length, break between students. A box explains the strict 5-minute entry rule |
| **Students** | For "selected" vivas: tick students (with resume status badges) |
| **Examiners & allocation** (`AllocationEditor.tsx`) | Tick examiners (instructor + TAs). "Split evenly" shares students alphabetically. Each examiner card lists their students in order with the slot time; ↑/↓ reorder; a dropdown moves a student to another examiner or back to "not allocated" |
| **Interview instructions** | Text + optional files the AI reads |
| **Evaluation criteria** | Name, description, weight (shown as % of the total) |
| **Report format**, **Summary statistics** | What the report and class stats should contain |

The bottom bar shows unsaved changes and the Save / Schedule buttons. Errors from the backend (e.g.
"allocate every student to an examiner") appear there.

Slot times on screen are worked out in the browser with the same formula the backend uses:
`start + position × (length + break)`.

### 6.4 Statistics (`VivaStatsPanel.tsx`)

Tiles (assigned, resumes ready, joined on time, missed, average score), the chosen class statistics with real
numbers once results exist (mean/median, score bands, per-criterion averages, flags by type, top/bottom), and a
table per student: resume, viva status, examiner + slot, score (links to the report), mastery, risk, flags, and
a "Send feedback" form.

### 6.5 Live room — examiner side

- **Queue** (`ExaminerQueue.tsx`, the "Live room" tab): your students in slot order with status (not joined, in
  waiting room, live, ended, missed) and an **Open room** button. The class owner sees every examiner's queue
  and can "Step in". Refreshes every 10 s.
- **Console** (`ExaminerConsole.tsx`, the room page):
  1. Opens your camera and mic (`media.ts`), creates a `LiveRoom` (`room.ts`) which connects the WebSocket, and
     streams your audio to the server for the transcript.
  2. Every message from the server goes through one function, `apply()`, which updates the screen's state.
  3. Shows: the student's video with the **AI overlay** drawn on a canvas on top (`OverlayVideo` in
     `LiveParts.tsx`: face box, mesh lines, a yellow gaze arrow, red boxes for objects), your own small
     preview, **Mute mic**, the **risk** and **mastery** meters, the transcript with the AI's notes under each
     answer, the **Co-Pilot** suggestions (with "Show to student" and a box for your own question), and the
     **integrity flags** (click one to see its snapshot).
  4. **Start interview** / **End interview** send `start` / `end` through the WebSocket.
  5. After the end, the **Result** form appears: per-criterion scores pre-filled with the AI's averages,
     the overall score (with a "use weighted average" shortcut), notes → `PUT /viva-sessions/{id}/result`.

### 6.6 Live room — student side (`StudentLiveRoom.tsx`)

Shown inside the student's viva page once they've joined:

| Step | Screen | What happens |
|---|---|---|
| 1 | **Consent** | What is analysed and stored; tick "I agree" |
| 2 | **Device check** | Camera preview, **microphone and camera dropdowns**, a live mic level bar (Web Audio "analyser"). Continue unlocks once the mic hears you; a hint appears if the chosen mic is silent (common with virtual audio devices) |
| 3 | **Calibration** | Opens the live room. A dot visits the 4 screen corners (2.5 s each) while frames are sent; then the student reads a sentence for the voice print. Can be skipped if already done |
| 4 | **Waiting room** | Examiner's video appears when they open the room |
| 5 | **Interview** | Examiner's video large, own preview small, questions the examiner "shows" appear in a box |
| 6 | **Ended** | The page reloads the viva status ("attended"); feedback appears later |

Throughout, the student's browser sends **5 JPEG frames per second** (`streamFrames`) and **16 kHz audio**
(`streamAudio`) to the server.

### 6.7 Report (`SessionReportView.tsx`)

Four sections — summary, integrity timeline (with snapshots), answers (question, quote, AI notes), full
transcript — and **Download PDF**, which opens the browser's print dialog. Print styles in `globals.css` hide
everything except the report and switch to dark text on white.

---

## 7. How the media code works (`lib/live/`)

| Function | Does |
|---|---|
| `openCameraAndMic({audioId, videoId})` | Asks the browser for camera + mic (640×480, echo cancellation on). Without a choice it asks for the system **Default** microphone |
| `listDevices()` | Lists cameras and microphones for the dropdowns |
| `streamFrames(stream, room)` | Every 200 ms: draw the camera onto a hidden 480×360 canvas → JPEG (quality 0.7) → send with byte `0x01`. Skips a frame if the connection is backed up |
| `streamAudio(stream, room)` | An AudioWorklet copies mic samples; they're averaged down from 48 kHz to 16 kHz, converted to 16-bit numbers, and sent every 100 ms with byte `0x02` |
| `LiveRoom` (`room.ts`) | Opens the WebSocket with the token, reconnects with back-off, relays `signal` messages, and runs WebRTC (examiner offers, student answers) |

---

## 8. Design

Dark "glass" theme: colours are **design tokens** in `src/app/globals.css` under `@theme` (`--color-accent`,
`--color-success`, `--color-danger`…), used as Tailwind classes (`text-accent`, `bg-raised`). `.panel` is the
frosted-glass card. Change a colour once there and it changes everywhere. The app name comes from
`src/config/site.ts`.

---

## 9. Running and checking

```bash
cd frontend
npm install          # first time
npm run dev          # http://localhost:3000 (the backend must run too)
npm run lint         # code checks
npx tsc --noEmit     # type checks
npm run build        # production build (also catches errors)
```

`frontend/.env.local` (copy `.env.example`) can set `NEXT_PUBLIC_API_URL` and the Microsoft IDs. More in
[RUNNING_AND_TESTING.md](RUNNING_AND_TESTING.md).
