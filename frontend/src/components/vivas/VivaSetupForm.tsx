"use client";

import { useRef, useState } from "react";
import type { Criterion, StoredFile, SubmissionStatus, SummaryStat, Viva, VivaConductor, VivaSetup } from "@/types";
import { getAssignment, listAssignments } from "@/lib/api/assignments";
import { listMembers } from "@/lib/api/classes";
import { deleteFile } from "@/lib/api/files";
import { saveViva, scheduleViva, unscheduleViva, uploadVivaFiles } from "@/lib/api/vivas";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { FileChip } from "@/components/files/FileChip";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { Checkbox, FormError, SelectField, TextAreaField, TextField, inputClass } from "@/components/ui/Field";
import { PlusIcon, TrashIcon, UploadIcon, UsersIcon, XIcon } from "@/components/ui/Icons";
import { AllocationEditor } from "./AllocationEditor";
import { INSTRUCTIONS_EXAMPLE, REPORT_TEMPLATE, SUMMARY_STATS } from "./options";

/** Form state: like VivaSetup, but times are kept as <input type="datetime-local"> strings. */
type FormState = Omit<VivaSetup, "startsAt"> & { startsAt: string };

function toForm(v: Viva): FormState {
  return {
    title: v.title,
    assignmentId: v.assignmentId,
    studentIds: v.students.map((s) => s.id),
    startsAt: toLocalInput(v.startsAt),
    durationMinutes: v.durationMinutes,
    conductedBy: v.conductedBy,
    breakMinutes: v.breakMinutes,
    examinerIds: v.examinerIds,
    allocation: v.slots.map((s) => ({ studentId: s.student.id, examinerId: s.examinerId })),
    interviewInstructions: v.interviewInstructions,
    evaluationCriteria: v.evaluationCriteria,
    reportFormat: v.reportFormat,
    summaryStats: v.summaryStats,
  };
}

function toSetup(f: FormState, audience: Viva["audience"]): VivaSetup {
  // Drop slots of students who were just un-picked, and of examiners who were just removed.
  const allocation = f.allocation.filter(
    (a) => f.examinerIds.includes(a.examinerId) && (audience === "whole_class" || f.studentIds.includes(a.studentId)),
  );
  return { ...f, allocation, startsAt: fromLocalInput(f.startsAt) };
}

const RESUME_BADGE: Record<SubmissionStatus, React.ReactNode> = {
  submitted: <Badge tone="success">Resume in</Badge>,
  late: <Badge tone="warning">Resume late</Badge>,
  missing: <Badge>No resume</Badge>,
};

export function VivaSetupForm({
  viva,
  onSaved,
  onFilesChange,
}: {
  viva: Viva;
  onSaved: (viva: Viva) => void;
  onFilesChange: (files: StoredFile[]) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(viva));
  const [busy, setBusy] = useState<"save" | "schedule" | "unschedule" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const assignments = useLoad(() => listAssignments(viva.classId), viva.classId);
  const members = useLoad(() => listMembers(viva.classId), viva.classId);
  const linked = useLoad(
    () => (form.assignmentId ? getAssignment(form.assignmentId) : Promise.resolve(null)),
    form.assignmentId ?? "none",
  );
  const resumeStatus = new Map(linked.data?.students.map((r) => [r.student.id, r.status]) ?? []);

  const locked = viva.phase === "live" || viva.phase === "closed";
  const scheduled = viva.status === "scheduled";
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(viva));

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice(null);
  };

  async function run(kind: "save" | "schedule" | "unschedule") {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      let saved = viva;
      if (dirty || kind === "save") saved = await saveViva(viva.id, toSetup(form, viva.audience));
      if (kind === "schedule") saved = await scheduleViva(viva.id);
      if (kind === "unschedule") saved = await unscheduleViva(viva.id);
      onSaved(saved);
      setForm(toForm(saved));
      setNotice(
        kind === "schedule" ? "Viva scheduled." : kind === "unschedule" ? "Moved back to draft." : "Changes saved.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {locked && (
        <p className="rounded-lg border border-border-strong bg-raised px-4 py-3 text-sm text-muted">
          This viva has {viva.phase === "live" ? "started" : "finished"}, so its setup can no longer be changed.
        </p>
      )}

      <fieldset disabled={locked} className="space-y-5">
        {/* ---------- Who runs it ---------- */}
        <ConductorPicker value={form.conductedBy} onChange={(v) => set("conductedBy", v)} />

        {/* ---------- Basics & schedule ---------- */}
        <Section title="Basics & schedule" description="When the viva is open, and which submissions the AI reads.">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Viva title" name="title" value={form.title} onChange={(e) => set("title", e.target.value)} />
            <SelectField
              label="Resumes & projects from"
              name="assignmentId"
              value={form.assignmentId ?? ""}
              onChange={(e) => set("assignmentId", e.target.value || null)}
              hint={
                linked.data
                  ? `${linked.data.submittedCount} of ${linked.data.totalStudents} students have submitted.`
                  : "The AI asks each student about the resume and projects they uploaded."
              }
            >
              <option value="">No assignment (course questions only)</option>
              {assignments.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Start time"
              name="startsAt"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
            />
            <div className="flex gap-4">
              <TextField
                label="Length of each viva (min)"
                name="durationMinutes"
                type="number"
                min={5}
                max={180}
                value={form.durationMinutes}
                onChange={(e) => set("durationMinutes", Number(e.target.value))}
                className="max-w-[8rem]"
              />
              {form.conductedBy === "staff" && (
                <TextField
                  label="Break between students (min)"
                  name="breakMinutes"
                  type="number"
                  min={0}
                  max={60}
                  value={form.breakMinutes}
                  onChange={(e) => set("breakMinutes", Number(e.target.value))}
                  className="max-w-[8rem]"
                />
              )}
            </div>
          </div>
          <JoinRule
            startsAt={form.startsAt}
            windowMinutes={viva.joinWindowMinutes}
            durationMinutes={form.durationMinutes}
            perSlot={form.conductedBy === "staff"}
          />
        </Section>

        {/* ---------- Students (selected audience only) ---------- */}
        {viva.audience === "selected" && (
          <StudentPicker
            members={members.data ?? []}
            loading={members.data === undefined}
            selected={form.studentIds}
            onChange={(ids) => set("studentIds", ids)}
            badgeFor={(id) => (form.assignmentId ? RESUME_BADGE[resumeStatus.get(id) ?? "missing"] : null)}
          />
        )}

        {/* ---------- Examiners & allocation (staff-run vivas) ---------- */}
        {form.conductedBy === "staff" && (
          <AllocationEditor
            staff={viva.staff}
            students={(members.data ?? []).filter(
              (m) => viva.audience === "whole_class" || form.studentIds.includes(m.id),
            )}
            examinerIds={form.examinerIds}
            allocation={form.allocation}
            startsAt={form.startsAt}
            durationMinutes={form.durationMinutes}
            breakMinutes={form.breakMinutes}
            onChange={({ examinerIds, allocation }) => {
              setForm((f) => ({ ...f, examinerIds, allocation }));
              setNotice(null);
            }}
          />
        )}

        {/* ---------- Interview instructions ---------- */}
        <Section
          title="Interview instructions"
          description="Tell the viva engine how to interview: what to focus on, how deep to go, what to avoid."
          actions={
            !form.interviewInstructions && (
              <Button size="sm" variant="ghost" onClick={() => set("interviewInstructions", INSTRUCTIONS_EXAMPLE)}>
                Use example
              </Button>
            )
          }
        >
          <TextAreaField
            label="Instructions"
            name="interviewInstructions"
            rows={8}
            value={form.interviewInstructions}
            onChange={(e) => set("interviewInstructions", e.target.value)}
            placeholder={INSTRUCTIONS_EXAMPLE}
          />
          <InstructionFiles viva={viva} onChange={onFilesChange} />
        </Section>

        {/* ---------- Evaluation criteria ---------- */}
        <CriteriaEditor criteria={form.evaluationCriteria} onChange={(c) => set("evaluationCriteria", c)} />

        {/* ---------- Report format ---------- */}
        <Section
          title="Report format (per student)"
          description="What each student's report should contain, in what order."
          actions={
            <Button size="sm" variant="ghost" onClick={() => set("reportFormat", REPORT_TEMPLATE)}>
              Use template
            </Button>
          }
        >
          <TextAreaField
            label="Format"
            name="reportFormat"
            rows={8}
            value={form.reportFormat}
            onChange={(e) => set("reportFormat", e.target.value)}
            placeholder={REPORT_TEMPLATE}
          />
        </Section>

        {/* ---------- Summary statistics ---------- */}
        <Section title="Summary statistics (whole class)" description="Shown in the Summary statistics tab once students finish.">
          <div className="grid gap-4 sm:grid-cols-2">
            {SUMMARY_STATS.map((s) => (
              <Checkbox
                key={s.value}
                label={s.label}
                description={s.description}
                checked={form.summaryStats.includes(s.value)}
                onChange={(e) =>
                  set(
                    "summaryStats",
                    e.target.checked
                      ? [...form.summaryStats, s.value]
                      : form.summaryStats.filter((x): x is SummaryStat => x !== s.value),
                  )
                }
              />
            ))}
          </div>
        </Section>
      </fieldset>

      {/* ---------- Action bar ---------- */}
      {!locked && (
        <div className="glass-float sticky bottom-3 z-20 rounded-2xl shadow-[0_16px_36px_-18px_rgb(90_50_170/0.5)] lg:bottom-8">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1 text-sm">
              {error ? (
                <FormError message={error} />
              ) : (
                <span className="text-muted">{notice ?? (dirty ? "Unsaved changes" : "All changes saved")}</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!!busy || !dirty} onClick={() => run("save")}>
                {busy === "save" ? "Saving…" : scheduled ? "Save changes" : "Save draft"}
              </Button>
              {scheduled ? (
                <Button variant="ghost" disabled={!!busy} onClick={() => run("unschedule")}>
                  {busy === "unschedule" ? "…" : "Back to draft"}
                </Button>
              ) : (
                <Button variant="accent" disabled={!!busy} onClick={() => run("schedule")}>
                  {busy === "schedule" ? "Scheduling…" : "Schedule viva"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentPicker({
  members,
  loading,
  selected,
  onChange,
  badgeFor,
}: {
  members: { id: string; name: string; email: string }[];
  loading: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  badgeFor: (id: string) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.includes(q));
  const chosen = new Set(selected);

  return (
    <Section
      title="Students"
      description={`${selected.length} of ${members.length} selected`}
      actions={
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onChange(members.map((m) => m.id))}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-muted">Loading students…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted">No students in this class yet.</p>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search students"
            aria-label="Search students"
            className={`${inputClass} mb-3 max-w-xs`}
          />
          <ul className="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2">
            {shown.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-raised">
                <Checkbox
                  label={m.name}
                  description={m.email}
                  checked={chosen.has(m.id)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id))}
                />
                {badgeFor(m.id)}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function CriteriaEditor({ criteria, onChange }: { criteria: Criterion[]; onChange: (c: Criterion[]) => void }) {
  const total = criteria.reduce((sum, c) => sum + (c.weight || 0), 0);
  const update = (i: number, patch: Partial<Criterion>) => onChange(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Section
      title="Evaluation criteria"
      description="What the AI scores each student on. Weights are relative; the share of the final score is shown."
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={criteria.length >= 20}
          onClick={() => onChange([...criteria, { name: "", description: "", weight: 10 }])}
        >
          <PlusIcon className="h-3.5 w-3.5" /> Add criterion
        </Button>
      }
    >
      {criteria.length === 0 ? (
        <p className="text-sm text-muted">No criteria yet. Add at least one.</p>
      ) : (
        <ul className="space-y-3">
          {criteria.map((c, i) => (
            <li key={i} className="grid gap-2 rounded-xl border border-border bg-tint p-3 md:grid-cols-[1fr_2fr_auto_auto] md:items-start">
              <input
                value={c.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Criterion"
                aria-label="Criterion name"
                maxLength={80}
                className={inputClass}
              />
              <input
                value={c.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="What a strong answer shows"
                aria-label="Criterion description"
                maxLength={500}
                className={inputClass}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={c.weight}
                  onChange={(e) => update(i, { weight: Number(e.target.value) })}
                  aria-label="Weight"
                  className={`${inputClass} max-w-20`}
                />
                <span className="w-10 text-right text-xs text-muted tabular-nums">
                  {total ? Math.round(((c.weight || 0) / total) * 100) : 0}%
                </span>
              </div>
              <button
                type="button"
                onClick={() => onChange(criteria.filter((_, j) => j !== i))}
                aria-label={`Remove ${c.name || "criterion"}`}
                className="self-center justify-self-end rounded-md p-2 text-subtle hover:bg-raised hover:text-danger"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function InstructionFiles({ viva, onChange }: { viva: Viva; onChange: (files: StoredFile[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      onChange([...viva.files, ...(await uploadVivaFiles(viva.id, Array.from(files)))]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(file: StoredFile) {
    setError(null);
    try {
      await deleteFile(file.id);
      onChange(viva.files.filter((f) => f.id !== file.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed border-border-strong p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">Instruction files</span>{" "}
          <span className="text-muted">— e.g. a rubric or interview guide (PDF, DOCX, TXT, MD). The AI reads them too.</span>
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          <UploadIcon className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      {viva.files.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {viva.files.map((f) => (
            <li key={f.id} className="flex items-center gap-1">
              <FileChip file={f} />
              <button
                type="button"
                onClick={() => remove(f)}
                aria-label={`Remove ${f.name}`}
                className="rounded p-1 text-subtle hover:text-danger"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-3">
          <FormError message={error} />
        </div>
      )}
    </div>
  );
}

/** Instructor & TAs (live now) or the AI examiner (coming later). */
function ConductorPicker({ value, onChange }: { value: VivaConductor; onChange: (v: VivaConductor) => void }) {
  const options: { value: VivaConductor; title: string; body: string; disabled?: boolean }[] = [
    {
      value: "staff",
      title: "Instructor & TAs",
      body: "You and your TAs interview students one-to-one by video, in parallel. The AI watches integrity, transcribes, grades answers and suggests follow-up questions.",
    },
    {
      value: "ai",
      title: "AI examiner",
      body: "The AI asks the questions itself, so every student can take the viva at the same time.",
      disabled: true,
    },
  ];
  return (
    <Section title="Who conducts the viva" description="Staff-run vivas take as many students at once as you have examiners.">
      <div role="radiogroup" className="grid gap-3 md:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
              value === o.value ? "border-accent/60 bg-accent-soft" : "border-border hover:bg-raised"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {o.value === "staff" && <UsersIcon className="h-4 w-4 text-accent" />}
              {o.title}
              {o.disabled && <Badge>Coming soon</Badge>}
            </span>
            <span className="mt-1 block text-xs text-muted">{o.body}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Explains the strict entry rule with the actual times for this viva. */
function JoinRule({
  startsAt,
  windowMinutes,
  durationMinutes,
  perSlot,
}: {
  startsAt: string;
  windowMinutes: number;
  durationMinutes: number;
  perSlot: boolean;
}) {
  const start = fromLocalInput(startsAt);
  const at = (minutes: number) => start && formatDateTime(new Date(new Date(start).getTime() + minutes * 60_000).toISOString());
  if (perSlot) {
    return (
      <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] p-4 text-sm">
        <p className="font-medium text-warning">Strict entry: {windowMinutes} minutes from each student&apos;s slot</p>
        <p className="mt-1 text-muted">
          Each student sees their own slot time and examiner. They must open the viva within {windowMinutes} minutes of
          their slot; after that, entry is closed and their report says they were not on time.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] p-4 text-sm">
      <p className="font-medium text-warning">Strict entry: {windowMinutes} minutes</p>
      <p className="mt-1 text-muted">
        {start ? (
          <>
            Students must open the viva between <span className="text-text">{at(0)}</span> and{" "}
            <span className="text-text">{at(windowMinutes)}</span>. After that, entry is closed: they can&apos;t take
            the viva and their report says they were not on time. The last viva ends by{" "}
            <span className="text-text">{at(windowMinutes + (durationMinutes || 0))}</span>.
          </>
        ) : (
          `Students must open the viva within ${windowMinutes} minutes of the start time. After that, entry is closed and their report says they were not on time.`
        )}
      </p>
    </div>
  );
}
