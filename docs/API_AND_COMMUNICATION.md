# How the Browser and Server Communicate

This guide covers every way the pieces talk to each other:

1. **REST API calls** (normal request → response) — sections 1 to 5
2. **The live-room WebSocket** (messages both ways, any time) — section 6
3. **The video call** (WebRTC, browser to browser) — section 7

Start with [EXPLANATION.md](EXPLANATION.md) if you haven't read the overview.

---

## 1. The basics of a request

```
POST http://localhost:8000/api/classes/join          ← method + full address
Authorization: Bearer eyJhbGciOiJIUzI1NiIs…           ← header: who I am
Content-Type: application/json                        ← header: the body is JSON
                                                      
{ "code": "K7M2QX" }                                  ← body: the data
```

and the answer:

```
HTTP/1.1 200 OK                                       ← status code
Content-Type: application/json

{ "id": "3f2b…", "name": "ML", "subject": "ML", "myRole": "student", "memberCount": 9, … }
```

| Part | Meaning |
|---|---|
| **Method** | `GET` = read, `POST` = create or do, `PUT` = replace/set, `DELETE` = remove |
| **Base address** | `http://localhost:8000/api` (set in the frontend by `NEXT_PUBLIC_API_URL`) |
| **Path parameters** | Parts of the path that vary, written `{id}` below, e.g. `/api/vivas/{viva_id}` |
| **Query parameters** | After `?`, e.g. `/api/classes/{id}/ta-candidates?q=asha` |
| **Status code** | `200` OK, `201` created, `204` done (no body), `400` bad input, `401` not signed in, `403` not allowed, `404` not found (or hidden), `409` conflict (e.g. already joined), `422` input in the wrong shape |
| **camelCase** | The JSON uses `joinCode`, `startsAt`; the Python code uses `join_code`, `starts_at`. A converter in `backend/app/schemas/base.py` translates automatically |
| **Times** | Always ISO-8601 with timezone, in UTC: `"2026-10-16T06:40:00Z"`. The browser converts to your local time for display |

### Where the calls are made in the code

| Side | File | What it does |
|---|---|---|
| Frontend | `frontend/src/lib/api/client.ts` → `api()` | The one function every call goes through: adds the token, sends JSON or files, turns errors into readable messages |
| Frontend | `frontend/src/lib/api/classes.ts`, `assignments.ts`, `files.ts`, `vivas.ts` | One small function per endpoint, e.g. `joinClass(code)` |
| Backend | `backend/app/api/routes/*.py` | One Python function per endpoint |
| Backend | `backend/app/services/*.py` | The rules each endpoint applies |

You can **try every endpoint by hand** at http://localhost:8000/docs while the backend runs. Click
"Authorize" and paste a token (see 2.2 for how to get one).

---

## 2. Signing in and the token

### 2.1 Developer sign-in (current)

```
POST /api/auth/dev-login
{ "name": "Asha Rao", "email": "asha@school.edu" }
→ 200 { "accessToken": "eyJ…", "tokenType": "bearer",
        "user": { "id": "…", "name": "Asha Rao", "email": "asha@school.edu", "role": null } }
```

- Only works while `AUTH_MODE=dev` in the backend settings.
- Personal domains (gmail.com, outlook.com, …) are rejected; reserved test domains (`.test`, `.local`) too.
- An existing email signs in as that user (keeping their role). A new email creates a user with `role: null`.
- Then the role is chosen once: `PUT /api/users/me/role` with `{ "role": "student" }` or `"instructor"`.

### 2.2 Microsoft sign-in (ready, switched off)

```
Browser ──► Microsoft login page ──► back to /register with an ID token
Browser ──► POST /api/auth/microsoft { "idToken": "…" }
Backend:    checks the token's signature with Microsoft's public keys, that it's for this app and tenant,
            and not expired → takes name + email from it → same as dev sign-in from here
```

It turns on when the Azure app IDs are set in `backend/.env` and `frontend/.env.local`. The steps are in
`backend/README.md`. With Microsoft sign-in, nobody can type someone else's email.

### 2.3 The token on every request

The token is a **JWT** (JSON Web Token): a string containing "user id X, valid until Y", **signed** with the
server's secret (`JWT_SECRET`). Anyone can read it, but nobody can forge or alter it without the secret.

| Step | Where |
|---|---|
| Made at sign-in, valid 24 h | `backend/app/core/security.py` → `create_access_token` |
| Kept by the browser in **localStorage** under `viva.session` (`{ token, user }`) | `frontend/src/lib/auth/session.ts` |
| Sent with every call as `Authorization: Bearer <token>` | `frontend/src/lib/api/client.ts` |
| Checked before every endpoint runs | `backend/app/api/deps.py` → `get_current_user` / `get_registered_user` |

The server keeps no list of who is logged in: the token itself is the proof. Signing out = the browser forgets
it. If the backend answers `401` (missing/expired token), the frontend clears the session and shows the sign-in
page.

WebSockets can't carry headers from a browser, so the live room sends the token in the address instead:
`ws://localhost:8000/api/ws/vivas/{viva_id}/students/{student_id}?token=eyJ…`.

---

## 3. Every endpoint

"Staff" = the class owner and its TAs. "Student" = a member of the class. Anyone else gets `404`, so the
class's existence isn't revealed.

### 3.1 Health and accounts

| Method | Path | Who | Does |
|---|---|---|---|
| GET | `/api/health` | anyone | Server + database check → `{"status": "ok"}` |
| GET | `/api/auth/config` | anyone | Which sign-in methods are on |
| POST | `/api/auth/dev-login` | anyone (dev mode) | Name + email → token |
| POST | `/api/auth/microsoft` | anyone | Microsoft ID token → token |
| GET | `/api/users/me` | signed in | The current user |
| PUT | `/api/users/me/role` | signed in | Choose Student / Instructor (once) |

### 3.2 Classes and TAs

| Method | Path | Who | Does |
|---|---|---|---|
| POST | `/api/classes` | instructors | Create a class → returns its join code |
| POST | `/api/classes/join` | registered | Join with `{ "code": "K7M2QX" }` |
| GET | `/api/classes/mine` | registered | `{ teaching, assisting, joined }` lists |
| GET | `/api/classes/{id}` | staff or student | Class details + `myRole` (`owner` / `ta` / `student`). Join code only for staff |
| GET | `/api/classes/{id}/members` | staff | Students (not TAs) |
| GET | `/api/classes/{id}/tas` | staff | TAs |
| GET | `/api/classes/{id}/ta-candidates?q=` | owner | Search registered users (3+ characters) |
| POST | `/api/classes/{id}/tas` | owner | Add a TA: `{ "userId": "…" }` |
| DELETE | `/api/classes/{id}/tas/{userId}` | owner | Remove a TA |

### 3.3 Assignments

| Method | Path | Who | Does |
|---|---|---|---|
| POST / GET | `/api/classes/{id}/assignments` | staff | Create (title, instructions, deadline, optional marks) / list with counts |
| GET / PUT / DELETE | `/api/assignments/{id}` | staff | Roster (submitted / late / missing + files) / edit / delete |
| POST | `/api/assignments/{id}/submission` | student | Turn in (multipart): new `files`, `keepFileIds`, `githubLinks`, `note`. Closed after the deadline |
| PUT | `/api/submissions/{id}/grade` | staff | Return with `marks`, `feedback`, `attachments` (multipart) |
| GET | `/api/classes/{id}/my-assignments` | student | My assignments with status and returned feedback |
| GET | `/api/assignments/{id}/mine` | student | One of them |

### 3.4 Files

| Method | Path | Who | Does |
|---|---|---|---|
| GET | `/api/classes/{id}/files` | staff / student | Staff: every file. Students: only class material |
| POST | `/api/classes/{id}/files` | staff | Upload class material (multipart) |
| GET | `/api/files/{id}/download` | see note | Download. Staff: any class file. Students: own uploads, material, feedback returned to them |
| DELETE | `/api/files/{id}` | staff | Staff uploads only (student submissions can't be deleted) |

### 3.5 Vivas: setup, scheduling, results

| Method | Path | Who | Does |
|---|---|---|---|
| POST / GET | `/api/classes/{id}/vivas` | staff | New draft (`whole_class` or `selected`) / list |
| GET | `/api/vivas/{id}` | staff | Full setup, incl. `staff`, `examinerIds`, `slots`, `unallocated` |
| PUT | `/api/vivas/{id}` | staff | Save the setup (see the body below) |
| DELETE | `/api/vivas/{id}` | staff | Delete (not while live) |
| POST | `/api/vivas/{id}/schedule` | staff | Check the setup is complete, then publish |
| POST | `/api/vivas/{id}/unschedule` | staff | Back to draft (before it starts) |
| POST | `/api/vivas/{id}/files` | staff | Upload instruction files (rubric, guide) |
| GET | `/api/vivas/{id}/stats` | staff | Readiness + results per student and for the class |
| PUT | `/api/vivas/{id}/students/{studentId}/feedback` | staff | Send feedback text + files (multipart) |
| GET | `/api/classes/{id}/my-vivas` | student | My scheduled vivas with my slot, examiner, status |
| GET | `/api/vivas/{id}/mine` | student | One of them |
| POST | `/api/vivas/{id}/join` | assigned student | Open it. Only within 5 minutes of **my slot** |

The setup body (`PUT /api/vivas/{id}`):

```json
{
  "title": "Project viva",
  "assignmentId": "…",                          // whose submissions the AI reads (resume, projects)
  "studentIds": [],                             // only for "selected" vivas
  "startsAt": "2026-10-20T04:30:00Z",
  "durationMinutes": 15,
  "conductedBy": "staff",                       // "ai" exists but can't be scheduled yet
  "breakMinutes": 5,
  "examinerIds": ["<instructor id>", "<TA id>"],
  "allocation": [                               // order matters: each examiner's queue, in order
    { "studentId": "asha", "examinerId": "<TA id>" },
    { "studentId": "ravi", "examinerId": "<instructor id>" },
    { "studentId": "meera", "examinerId": "<TA id>" }
  ],
  "interviewInstructions": "Start with their main project…",
  "evaluationCriteria": [{ "name": "Conceptual understanding", "description": "…", "weight": 40 }],
  "reportFormat": "Score, strengths, gaps…",
  "summaryStats": ["average_score", "criteria_breakdown"]
}
```

From the allocation the backend works out each slot: **slot start = start time + position × (length + break)**.
In the example, Asha and Ravi both start at 04:30 (position 0 with different examiners) and Meera at 04:50
(position 1 for the TA, with 15 + 5 minutes before her).

### 3.6 Live vivas

| Method | Path | Who | Does |
|---|---|---|---|
| GET | `/api/vivas/{id}/queue` | staff | My students in slot order, with live status (owner sees all examiners) |
| **WS** | `/api/ws/vivas/{id}/students/{studentId}?token=` | that student, their examiner, the owner | The live room (section 6) |
| GET | `/api/viva-sessions/{sessionId}` | staff | The session report: scores, flags, graded answers, transcript |
| POST | `/api/viva-sessions/{sessionId}/end` | staff | End the interview (normally done through the WebSocket) |
| PUT | `/api/viva-sessions/{sessionId}/result` | staff | Examiner's decision: `{ "score": 7.5, "criteriaScores": [{"name": "…", "score": 7}], "notes": "…" }` |
| GET | `/api/viva-sessions/{sessionId}/events/{eventId}/snapshot` | staff | JPEG snapshot of a flag |
| GET | `/api/live/engines` | signed in | Which AI models are loaded / failed |

---

## 4. Uploading and downloading files

Uploads don't use JSON; they use **multipart/form-data**, the format HTML forms use for files. The frontend
builds a `FormData` object, adds each file and field, and sends it:

```ts
const form = new FormData();
files.forEach((f) => form.append("files", f));
await api(`/classes/${classId}/files`, { method: "POST", body: form });
```

On the backend, FastAPI reads `files: list[UploadFile]`, and `backend/app/core/storage.py` checks the extension
and size (max 15 MB by default) and writes the bytes to `uploads/<class id>/<kind>/<random name>`.

Downloads need the token too, so the browser can't use a plain link. `downloadFile()` in `client.ts` fetches
the file with the token, turns it into a temporary in-browser link, and clicks it to save. Integrity snapshots
are loaded the same way (`snapshotUrl()` in `lib/api/vivas.ts`).

---

## 5. Errors

Every error from the backend looks the same:

```json
{ "detail": "You have already joined this class." }
```

- Services raise `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound` or `Conflict`
  (`backend/app/core/errors.py`); one handler in `main.py` turns them into this shape with the right status.
- For wrongly shaped input (`422`), FastAPI's own `detail` is a list; the frontend shows the first message.
- `client.ts` turns any error into an `ApiError` with that text, which pages show in a red box.
- If the backend can't be reached at all: "Can't reach the server. Is the backend running?"

### CORS

The page comes from `localhost:3000` and the API is at `localhost:8000` — different addresses. Browsers block
such cross-address calls unless the server explicitly allows them (**CORS**). The backend allows the
addresses in `CORS_ORIGINS` (by default `http://localhost:3000` and `http://127.0.0.1:3000`). Before some
requests the browser first sends an `OPTIONS` "may I?" request; you'll see those in the backend log.

---

## 6. The live room (WebSocket)

### 6.1 Connecting

Both the student and the examiner connect to the **same address** for that student:

```
ws://localhost:8000/api/ws/vivas/{viva_id}/students/{student_id}?token=<their own token>
```

The backend (`backend/app/api/routes/live.py` → `live_room`) checks:

| Who | Allowed if | Else closes with |
|---|---|---|
| The student | It's their own id, they joined the viva (`POST …/join`), and the viva is staff-run and scheduled | `4403` "Join the viva first." |
| Staff | They're the student's allotted examiner, or the class owner | `4403` "<name> is this student's examiner." |
| Bad/expired token | — | `4401` |
| Same person opens a second tab | The older tab is closed | `4409` "Opened somewhere else." |

Then the room is created in memory (`backend/app/live/session.py` → `LiveSession`), along with a database row
(`viva_sessions`) the first time.

### 6.2 Two kinds of messages

- **Text messages** are JSON: `{ "type": "start" }`, `{ "type": "turn", "turn": {…} }`.
- **Binary messages** carry media. The first byte says what it is:

| First byte | Then | From | Rate |
|---|---|---|---|
| `0x01` | a JPEG image, 480×360 | student | 5 per second |
| `0x02` | raw audio: 16 000 samples/second, 16-bit, mono (PCM) | student and examiner | ~10 chunks per second (100 ms each) |

The browser captures these in `frontend/src/lib/live/media.ts`: frames by drawing the camera onto a hidden
canvas and saving it as JPEG; audio with an **AudioWorklet** (a small audio-processing script running on the
browser's audio thread), downsampled from 48 kHz to 16 kHz.

### 6.3 Messages from the browsers to the server

| Type | Sent by | Fields | Effect |
|---|---|---|---|
| `signal` | both | `data` (WebRTC offer/answer/candidate) | Passed unchanged to the other side (section 7) |
| `calibration` | student | `step`: `corners_start`, `corners_done`, `voice_start`, `voice_done` | Gaze bounds / voice print recording (see LIVE_VIVA_ENGINE.md) |
| `start` | examiner | — | Interview goes live: the AI starts flagging, transcribing and grading |
| `end` | examiner | — | Close open flags, grade the last answer, mark the session ended, tell the student |
| `show_question` | examiner | `text` | Shown on the student's screen, added to the transcript |
| `suggest` | examiner | — | Ask the Co-Pilot for new suggestions |
| `grade_now` | examiner | — | Grade the current answer without waiting for the next question |

### 6.4 Messages from the server to the browsers

| Type | To | Contains | When |
|---|---|---|---|
| `state` | both | status (`waiting` / `live` / `ended`), calibrated?, who is online. Examiner's version also: session id, all flags and transcript so far, suggestions, engine health, mesh layout | On connect, and when the status changes |
| `presence` | both | `{ "student": true }` / `{ "examiner": false }` | The other side connects / disconnects |
| `signal` | both | WebRTC data from the other side | During the handshake |
| `question` | student | `text` | Examiner pressed "Show" |
| `ended` | student | — | Examiner ended the interview |
| `calibration` | both | step done; for the student the computed bounds / whether the voice print worked | During calibration |
| `frame` | examiner | faces, face boxes, mesh points, eye direction, head yaw/pitch, objects | After each analysed frame (~5/s), drawn as the video overlay |
| `scores` | examiner | time, risk, mastery, analysed fps, who is speaking, status | Every second |
| `event` | examiner | one integrity flag (type, times, confidence, snapshot?, still open?) | When a flag opens and when it closes |
| `turn` | examiner | one transcript line (speaker, text, times) | After speech-to-text finishes an utterance |
| `grade` | examiner | the analysis of one answer + new mastery | After grading |
| `suggestions` | examiner | list of `{question, kind, why, criterion}`, or an error, or "loading" | When the Co-Pilot is asked / finishes |

If the connection drops (Wi-Fi blip), `frontend/src/lib/live/room.ts` reconnects automatically after 0.5 s,
1 s, 2 s … up to 8 s. The room on the server keeps its state, so nothing is lost.

---

## 7. The video call (WebRTC)

### 7.1 Why the backend isn't in the middle

Streaming video through a server costs a lot of bandwidth and adds delay. **WebRTC** lets the two browsers
send video and audio **directly to each other**. But to connect, each browser must first learn:

- what the other can send and receive (video format, audio format) — the **SDP** ("session description"), and
- network addresses where it can be reached — the **ICE candidates**.

Exchanging these notes is called **signalling**. WebRTC doesn't say how to do it; this app uses the live-room
WebSocket: each note is sent as `{ "type": "signal", "data": … }`, and the backend forwards it untouched.

### 7.2 The handshake, step by step

```
Examiner's browser                     Backend (relay)                      Student's browser
       │                                     │                                      │
       │  (student online → start a call)    │                                      │
       │  createOffer()                      │                                      │
       │── signal {sdp: offer} ─────────────►│── signal {sdp: offer} ──────────────►│
       │                                     │                                      │ setRemoteDescription(offer)
       │                                     │                                      │ createAnswer()
       │◄─ signal {sdp: answer} ─────────────│◄─ signal {sdp: answer} ──────────────│
       │ setRemoteDescription(answer)        │                                      │
       │── signal {candidate} ──────────────►│── signal {candidate} ───────────────►│  addIceCandidate
       │◄─ signal {candidate} ───────────────│◄─ signal {candidate} ────────────────│  (several each way)
       │                                                                            │
       │◄══════════════════ video + audio flow directly between the browsers ══════►│
```

Rules that keep it simple (`frontend/src/lib/live/room.ts`):

- The **examiner always makes the offer**; the student only answers. So both never call at once.
- Whenever the student comes (back) online, the examiner starts a fresh call.
- ICE candidates that arrive before the offer/answer are queued and added afterwards.

### 7.3 STUN and TURN

- A **STUN server** answers "what's my public address?". It's needed when the browsers are on different
  networks. The app uses Google's free STUN server.
- Some networks (strict firewalls, some campus or office Wi-Fi) block direct connections entirely. Then a
  **TURN server** must relay the video. **None is configured yet**: on the same machine or the same home network
  this doesn't matter, but for a real deployment one should be added (free tiers exist).

---

## 8. Putting it together: one viva, as messages

```
Student browser           Backend                                  Examiner browser
GET  /vivas/X/mine  ────► slot 10:20, examiner Tara
POST /vivas/X/join  ────► ok (within 5 min of slot)
WS connect ─────────────► LiveSession created, row in viva_sessions
  ◄──── state {waiting}
calibration corners_start ─►
0x01 frames … ────────────► vision → gaze samples
calibration corners_done ──► bounds saved      ──── calibration ────────►
calibration voice_start ───►
0x02 audio … ─────────────► collected for the voice print
calibration voice_done ────► voice print saved  ──── calibration ────────►
                                                ◄─── GET /vivas/X/queue
                                                ◄─── WS connect
                          ──── presence{examiner} ──►  state{studentOnline}──►
  ◄── signal offer ─────── relay ◄─────────────────────────── signal offer
  ── signal answer ───────► relay ───────────────────────────► signal answer
  ◄════════════════════════ WebRTC video call ═══════════════════════════════►
                                                ◄─── start
  ◄── state{live}                                 ──── state{live} ────────►
0x01 frames, 0x02 audio ──► vision + rules      ──── frame (overlay) ────►
                            flags               ──── event ──────────────►
                            speech-to-text      ──── turn ───────────────►   ◄── 0x02 audio (examiner)
                            grader + Co-Pilot   ──── grade, suggestions ─►
                            every second        ──── scores ─────────────►
                                                ◄─── end
  ◄── ended                 session ended       ──── state{ended} ───────►
                                                ◄─── PUT /viva-sessions/S/result
                                                ◄─── GET /viva-sessions/S  (report)
```
