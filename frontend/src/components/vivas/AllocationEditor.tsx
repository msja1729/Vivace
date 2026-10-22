"use client";

import type { Examiner, Person } from "@/types";
import { fromLocalInput } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Avatar, Badge } from "@/components/ui/Display";
import { Checkbox, inputClass } from "@/components/ui/Field";
import { ArrowDownIcon } from "@/components/ui/Icons";

export type Allocation = { studentId: string; examinerId: string }[];

const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Instructor & TAs interview students one-to-one. Each examiner works through their own queue,
 * so the examiners run in parallel: slot n starts at start + n × (length + break). */
export function AllocationEditor({
  staff,
  students,
  examinerIds,
  allocation,
  startsAt,
  durationMinutes,
  breakMinutes,
  onChange,
}: {
  staff: Examiner[];
  students: Person[];
  examinerIds: string[];
  allocation: Allocation;
  startsAt: string; // <input type="datetime-local"> value
  durationMinutes: number;
  breakMinutes: number;
  onChange: (next: { examinerIds: string[]; allocation: Allocation }) => void;
}) {
  const byId = new Map(students.map((s) => [s.id, s]));
  const examiners = staff.filter((e) => examinerIds.includes(e.id));
  const live = allocation.filter((a) => byId.has(a.studentId) && examinerIds.includes(a.examinerId));
  const allocated = new Set(live.map((a) => a.studentId));
  const unallocated = students.filter((s) => !allocated.has(s.id));
  const queue = (examinerId: string) => live.filter((a) => a.examinerId === examinerId).map((a) => a.studentId);

  const start = fromLocalInput(startsAt);
  const slotStart = (position: number) =>
    start ? new Date(new Date(start).getTime() + position * (durationMinutes + breakMinutes) * 60_000) : null;
  const longest = Math.max(0, ...examiners.map((e) => queue(e.id).length));
  const lastEnd = longest && slotStart(longest - 1);

  const emit = (nextAllocation: Allocation, nextExaminers = examinerIds) =>
    onChange({ examinerIds: nextExaminers, allocation: nextAllocation });

  /** Rebuild the allocation from per-examiner queues (keeps examiner order stable). */
  const fromQueues = (queues: Map<string, string[]>) =>
    [...queues].flatMap(([examinerId, ids]) => ids.map((studentId) => ({ studentId, examinerId })));

  const queues = () => new Map(examiners.map((e) => [e.id, queue(e.id)]));

  function toggleExaminer(id: string, on: boolean) {
    const ids = on ? [...examinerIds, id] : examinerIds.filter((x) => x !== id);
    // Removing an examiner sends their students back to "not allocated".
    emit(on ? live : live.filter((a) => a.examinerId !== id), ids);
  }

  function splitEvenly() {
    if (!examiners.length) return;
    const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name));
    // Consecutive blocks (alphabetical), as even as possible.
    const size = Math.floor(sorted.length / examiners.length);
    const extra = sorted.length % examiners.length;
    const q = new Map<string, string[]>();
    let i = 0;
    examiners.forEach((e, n) => {
      const count = size + (n < extra ? 1 : 0);
      q.set(e.id, sorted.slice(i, i + count).map((s) => s.id));
      i += count;
    });
    emit(fromQueues(q));
  }

  function move(studentId: string, to: string | null) {
    const q = queues();
    for (const [k, ids] of q) q.set(k, ids.filter((x) => x !== studentId));
    if (to) q.set(to, [...(q.get(to) ?? []), studentId]);
    emit(fromQueues(q));
  }

  function shift(examinerId: string, index: number, delta: number) {
    const q = queues();
    const ids = [...(q.get(examinerId) ?? [])];
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    q.set(examinerId, ids);
    emit(fromQueues(q));
  }

  const MoveSelect = ({ studentId, current }: { studentId: string; current: string | null }) => (
    <select
      value={current ?? ""}
      onChange={(e) => move(studentId, e.target.value || null)}
      aria-label={`Examiner for ${byId.get(studentId)?.name}`}
      className={`${inputClass} w-auto max-w-40 py-1 text-xs`}
    >
      {!current && <option value="">Assign to…</option>}
      {examiners.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
      {current && <option value="">Remove</option>}
    </select>
  );

  return (
    <Section
      title="Examiners & allocation"
      description="Pick who interviews, then give each examiner their students. Examiners run in parallel; each takes their students one after another."
      actions={
        <Button size="sm" variant="outline" disabled={!examiners.length || !students.length} onClick={splitEvenly}>
          Split evenly
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Examiners ({examiners.length} of {staff.length})</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {staff.map((e) => (
              <Checkbox
                key={e.id}
                label={e.name}
                description={e.isOwner ? "Instructor" : "Teaching assistant"}
                checked={examinerIds.includes(e.id)}
                onChange={(ev) => toggleExaminer(e.id, ev.target.checked)}
              />
            ))}
          </div>
          {staff.length === 1 && (
            <p className="mt-2 text-xs text-subtle">Add TAs on the Members page to interview more students in parallel.</p>
          )}
        </div>

        <p className="rounded-lg border border-border bg-tint px-4 py-3 text-sm text-muted">
          {examiners.length ? (
            <>
              <span className="text-text">{examiners.length}</span> student{examiners.length === 1 ? "" : "s"} at a time ·{" "}
              {students.length} student{students.length === 1 ? "" : "s"} · {longest} round{longest === 1 ? "" : "s"} of{" "}
              {durationMinutes} min + {breakMinutes} min break
              {lastEnd && (
                <>
                  {" "}
                  · last viva starts <span className="text-text">{time(lastEnd)}</span>
                </>
              )}
            </>
          ) : (
            "Pick at least one examiner."
          )}
        </p>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {examiners.map((e) => {
            const ids = queue(e.id);
            return (
              <div key={e.id} className="rounded-xl border border-border bg-tint">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={e.name} className="h-7 w-7 text-[10px]" />
                    <span className="truncate text-sm font-medium">{e.name}</span>
                  </span>
                  <Badge tone={ids.length ? "accent" : "neutral"}>{ids.length} students</Badge>
                </div>
                {ids.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-subtle">No students yet.</p>
                ) : (
                  <ol className="divide-y divide-border">
                    {ids.map((sid, i) => {
                      const at = slotStart(i);
                      return (
                        <li key={sid} className="flex items-center gap-2 px-3 py-2">
                          <span className="w-12 shrink-0 text-xs text-muted tabular-nums">{at ? time(at) : `#${i + 1}`}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{byId.get(sid)?.name}</span>
                          <span className="flex shrink-0 items-center">
                            <button
                              type="button"
                              onClick={() => shift(e.id, i, -1)}
                              disabled={i === 0}
                              aria-label="Earlier"
                              className="rounded p-1 text-subtle hover:text-text disabled:opacity-30"
                            >
                              <ArrowDownIcon className="h-3.5 w-3.5 rotate-180" />
                            </button>
                            <button
                              type="button"
                              onClick={() => shift(e.id, i, 1)}
                              disabled={i === ids.length - 1}
                              aria-label="Later"
                              className="rounded p-1 text-subtle hover:text-text disabled:opacity-30"
                            >
                              <ArrowDownIcon className="h-3.5 w-3.5" />
                            </button>
                            <MoveSelect studentId={sid} current={e.id} />
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
        </div>

        {unallocated.length > 0 && (
          <div className="rounded-xl border border-warning/25 bg-warning/[0.05] p-4">
            <p className="text-sm font-medium text-warning">
              {unallocated.length} student{unallocated.length === 1 ? "" : "s"} not allocated
            </p>
            <p className="mt-0.5 text-xs text-muted">Every student needs an examiner before the viva can be scheduled.</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {unallocated.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-tint px-3 py-1.5">
                  <span className="truncate text-sm">{s.name}</span>
                  {examiners.length > 0 && <MoveSelect studentId={s.id} current={null} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
