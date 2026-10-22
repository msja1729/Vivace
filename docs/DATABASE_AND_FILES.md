# What Is Stored, and Where

Everything the app remembers lives in three places on the backend machine:

| Place | What | Path | In git? |
|---|---|---|---|
| **Database** | Users, classes, assignments, vivas, sessions, flags, transcript lines, scores | `backend/viva.db` (one SQLite file) | No |
| **Upload folder** | The actual bytes of uploaded files and integrity snapshots | `backend/uploads/` | No |
| **Model folder + cache** | Downloaded AI models (~1 GB) | `backend/models/` and `C:\Users\<you>\.cache\huggingface\` | No |

The browser stores only your **session** (token + user) in localStorage. The models and the database are on
the backend's machine, never in the browser.

---

## 1. Database basics

| Term | Meaning |
|---|---|
| **Table** | Like a spreadsheet sheet: one kind of record (users, classes …) |
| **Row** | One record (one user) |
| **Column** | One field (email) |
| **Primary key** | The unique id of each row. Most tables use random **UUIDs** like `3f2b7c1e-…` |
| **Foreign key** | A column pointing to a row in another table (`classes.instructor_id` → `users.id`) |
| **Unique constraint** | No two rows may share these values (one membership per user per class) |
| **Cascade delete** | Deleting a row also deletes the rows pointing to it (deleting a class deletes its assignments …) |
| **JSON column** | A column holding structured data (a list of criteria, an analysis object) |
| **SQLite** | The database engine: one file, no server to install. Fine for one machine and a pilot. For a real deployment you'd switch to **PostgreSQL** by changing `DATABASE_URL` |

All times are stored in **UTC** (`core/db.py` → `UTCDateTime`) and shown in local time by the browser.

---

## 2. The tables

### 2.1 People and classes (`models/user.py`, `models/classroom.py`)

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `name`, `email` (unique), `role` (`student` / `instructor` / empty), `created_at` | Role is chosen once at registration |
| `classes` | `id`, `name`, `subject`, `description`, `join_code` (unique, 6 chars), `instructor_id` → users | The owner is the instructor who created it |
| `class_members` | `class_id`, `user_id`, `joined_at` | One row per person who joined with the code (unique pair) |
| `class_tas` | `class_id`, `user_id`, `added_at` | Teaching assistants; a member who is also a TA isn't counted as a student |

### 2.2 Assignments and files (`models/assignment.py`, `models/file.py`)

| Table | Key columns | Notes |
|---|---|---|
| `assignments` | `class_id`, `title`, `instructions`, `deadline`, `graded`, `total_marks` | |
| `submissions` | `assignment_id`, `student_id` (unique pair), `github_links` (JSON list), `note`, `submitted_at`, `marks`, `feedback`, `returned_at` | Re-submitting updates the same row |
| `files` | `class_id`, `uploader_id`, `kind`, `name`, `content_type`, `size_bytes`, `storage_key`, and **one** of `submission_id` / `viva_id` / `viva_feedback_id` | The row is the file's label; the bytes are on disk at `uploads/<storage_key>` |

`kind` is one of: `submission`, `resume`, `transcript` (older submissions), `material` (class files),
`feedback` (returned with an assignment), `viva_instructions`, `viva_feedback`.

### 2.3 Vivas (`models/viva.py`)

| Table | Key columns | Notes |
|---|---|---|
| `vivas` | `class_id`, `title`, `audience` (`whole_class` / `selected`), `status` (`draft` / `scheduled`), **`conducted_by`** (`staff` / `ai`), `assignment_id`, `starts_at`, `ends_at`, `duration_minutes`, **`break_minutes`**, `interview_instructions`, `evaluation_criteria` (JSON), `report_format`, `summary_stats` (JSON) | `ends_at` is computed (last slot + window + duration) |
| `viva_students` | `viva_id`, `student_id` | Only for `selected` vivas: who takes it |
| **`viva_examiners`** | `viva_id`, `user_id` | Staff chosen to interview |
| **`viva_slots`** | `viva_id`, `student_id` (unique pair), `examiner_id`, `position` | The allocation: who interviews whom, in which turn. Slot time = `starts_at + position × (duration + break)` (computed, not stored) |
| `viva_attempts` | `viva_id`, `student_id`, `joined_at` | When the student clicked Join (proof they were on time) |
| `viva_feedback` | `viva_id`, `student_id`, `feedback`, `released_at` | Feedback sent to a student, plus attached files in `files` |

### 2.4 Live sessions (`models/live.py`)

| Table | Key columns | Notes |
|---|---|---|
| `viva_sessions` | `viva_id`, `student_id` (unique pair), `examiner_id`, `status` (`waiting` / `live` / `ended`), `started_at`, `ended_at`, `calibration` (JSON: gaze bounds + voice print numbers), `risk_score` (peak, 0–100), `mastery_score` (0–100), `score` (examiner, out of 10), `criteria_scores` (JSON), `notes`, `created_at` | Created when the student or examiner first opens the live room. `created_at` is "time 0" for all timestamps below |
| `viva_events` | `session_id`, `type`, `start_ts`, `end_ts` (seconds since time 0), `confidence`, `detail`, `snapshot_key` | One integrity flag, e.g. `gaze_off_screen` from 63.2 s to 69.8 s |
| `viva_turns` | `session_id`, `speaker` (`examiner` / `student`), `text`, `start_ts`, `end_ts`, `words`, `analysis` (JSON) | One transcript line. The first line of each student answer carries the grading and delivery metrics (see LIVE_VIVA_ENGINE.md §4.6) |

### 2.5 How they connect

```
users ──< classes ──< class_members >── users
             │  └───< class_tas >────── users
             ├───< assignments ──< submissions >── users
             │                         └──< files
             ├───< files (material)
             └───< vivas ──< viva_examiners >── users
                     ├────< viva_slots  (student → examiner, position)
                     ├────< viva_students / viva_attempts / viva_feedback
                     └────< viva_sessions ──< viva_events  (flags)
                                        └───< viva_turns   (transcript + analysis)

──<  means "one to many": one class has many assignments.
```

---

## 3. Migrations: changing the structure safely

The table structure is defined in `app/models/`. When a model changes (a new column, a new table), the
database file must be updated **without losing data**. **Alembic** does this with *migrations*: numbered files
in `backend/migrations/versions/`, each describing one change and how to undo it.

| Migration | Added |
|---|---|
| `74b9b72e0555_users_and_classes` | users, classes, class_members |
| `ebc0fd6c979e_assignments_files_and_vivas` | assignments, submissions, files, vivas, viva_students |
| `fc973c4746b1_viva_attempts_and_assignment_grading` | viva_attempts; grading: `graded`/`total_marks` on assignments, `marks`/`feedback`/`returned_at` on submissions |
| `24c6f96c1af6_class_teaching_assistants` | class_tas |
| `83ae7591b4cf_viva_feedback_and_feedback_files` | viva_feedback, and `viva_feedback_id` on files |
| `83c6c3e988b1_drop_collect_transcripts` | removed an unused viva setting (`collect_transcripts`) |
| `fb53756f5dfa_staff_vivas_allocation_and_live_sessions` | conducted_by, break_minutes, viva_examiners, viva_slots, viva_sessions, viva_events, viva_turns (existing vivas got their class staff as examiners) |

```bash
uv run alembic upgrade head                                  # bring the database up to date
uv run alembic revision --autogenerate -m "describe change"  # after editing a model: write a new migration
```

---

## 4. The upload folder

```
backend/uploads/
└── <class id>/
    ├── material/            class files
    ├── submission/          student assignment files
    ├── feedback/            files returned with assignments
    ├── viva_instructions/   rubrics / interview guides
    ├── viva_feedback/       files sent with viva feedback
    └── snapshots/
        └── <session id>/    one JPEG per integrity flag (the frame when it started)
```

- File names on disk are random (`5ab83ec2….pdf`), so two uploads can't clash and names reveal nothing. The
  original name is kept in the database.
- Snapshots are deleted `SNAPSHOT_RETENTION_DAYS` (default 30) after the session ended, at the next backend start.
  The flag itself stays, marked "no snapshot".
- No video or full audio is ever recorded. Only flag snapshots and the transcript text are kept.

---

## 5. Starting fresh

To wipe all data (users, classes, everything) while testing:

1. Stop the backend.
2. Move `backend/viva.db` and `backend/uploads/` somewhere as a backup (or delete them).
3. `uv run alembic upgrade head` — creates a new empty database.
4. In each browser, sign out (or clear the site's storage), because the old token points to a user that no
   longer exists. The frontend also clears it automatically on the first `401`.
