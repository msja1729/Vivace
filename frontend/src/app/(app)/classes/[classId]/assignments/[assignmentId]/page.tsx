"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { isStaff, type AssignmentDetail, type ClassRoom, type SubmissionStatus } from "@/types";
import { deleteAssignment, getAssignment, updateAssignment } from "@/lib/api/assignments";
import { formatDateTime, fromNow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { StudentAssignmentDetail } from "@/components/student/StudentAssignmentDetail";
import { AssignmentForm } from "@/components/assignments/AssignmentForm";
import { GradePanel } from "@/components/assignments/GradePanel";
import { SubmissionProgress } from "@/components/assignments/SubmissionProgress";
import { FileChip } from "@/components/files/FileChip";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Avatar, Badge, EmptyState, Loading, PageHeader, StatTile } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { LinkIcon, MicIcon, TrashIcon } from "@/components/ui/Icons";
import { SearchInput, matches } from "@/components/ui/SearchInput";

export default function AssignmentPage() {
  return <ClassPage>{(cls) => (isStaff(cls) ? <AssignmentDashboard cls={cls} /> : <StudentAssignmentDetail cls={cls} />)}</ClassPage>;
}

const FILTERS: { value: SubmissionStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Turned in" },
  { value: "missing", label: "Not turned in" },
];

const STATUS_BADGE: Record<SubmissionStatus, React.ReactNode> = {
  submitted: <Badge tone="success">Turned in</Badge>,
  late: <Badge tone="success">Turned in</Badge>, // only from before deadlines became strict
  missing: <Badge>Not turned in</Badge>,
};


function AssignmentDashboard({ cls }: { cls: ClassRoom }) {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const router = useRouter();
  const { data: a, error, setData, reload } = useLoad(() => getAssignment(assignmentId), assignmentId);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<SubmissionStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (a === undefined) return error ? <FormError message={error} /> : <Loading />;

  const rows = a.students.filter(
    (r) => (filter === "all" || r.status === filter) && matches(query, r.student.name, r.student.email),
  );
  const counts: Record<string, number> = {
    all: a.totalStudents,
    submitted: a.submittedCount,
    missing: a.missingCount,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assignment"
        title={a.title}
        description={
          <>
            Due {formatDateTime(a.deadline)} ({fromNow(a.deadline)}) · {a.isOpen ? "Open" : "Closed"} ·{" "}
            {a.graded ? `Graded out of ${a.totalMarks}` : "No marks"}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close editor" : "Edit"}
            </Button>
            <ConfirmButton
              label="Delete"
              icon={<TrashIcon />}
              onConfirm={async () => {
                try {
                  await deleteAssignment(a.id);
                  router.push(`/classes/${cls.id}/assignments`);
                } catch (err) {
                  setActionError((err as Error).message);
                }
              }}
            />
          </>
        }
      />
      <FormError message={actionError} />

      {editing && (
        <Card>
          <AssignmentForm
            initial={a}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              setData(await updateAssignment(a.id, input));
              setEditing(false);
            }}
          />
        </Card>
      )}

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${a.graded ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
        <StatTile label="Students" value={a.totalStudents} />
        <StatTile label="Turned in" value={counts.submitted} tone="success" />
        <StatTile label="Not turned in" value={a.missingCount} tone={a.missingCount ? "danger" : undefined} />
        <StatTile label="Returned" value={`${a.returnedCount}/${a.submittedCount}`} hint="with marks / feedback" />
        {a.graded && (
          <StatTile
            label="Average marks"
            value={a.averageMarks ?? "–"}
            hint={a.averageMarks !== null ? `out of ${a.totalMarks}` : "Nothing returned yet"}
            tone="accent"
          />
        )}
      </div>

      <Card>
        <SubmissionProgress a={a} />
        {a.instructions && <p className="mt-4 border-t border-border pt-4 text-sm whitespace-pre-line text-muted">{a.instructions}</p>}
      </Card>

      {a.submittedCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <span className="font-medium">{a.submittedCount} submission{a.submittedCount === 1 ? "" : "s"} ready.</span>{" "}
            <span className="text-muted">Set up a viva that questions students on these projects.</span>
          </p>
          <Button href={`/classes/${cls.id}/vivas`} variant="accent">
            <MicIcon /> Set up a viva
          </Button>
        </Card>
      )}

      <div className="panel overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter students">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filter === f.value ? "bg-raised text-text" : "text-muted hover:text-text"
              }`}
            >
              {f.label} <span className="ml-1 text-subtle tabular-nums">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search students" className="max-w-56" />
        </div>

        {a.totalStudents === 0 ? (
          <div className="p-5">
            <EmptyState title="No students in this class yet" description="Share the join code; new students see this assignment too." />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{query ? `No students match “${query}”.` : "Nobody in this group."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <SubmissionRow key={r.student.id} row={r} totalMarks={a.graded ? a.totalMarks : null} onReturned={reload} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SubmissionRow({
  row,
  totalMarks,
  onReturned,
}: {
  row: AssignmentDetail["students"][number];
  totalMarks: number | null;
  onReturned: () => void;
}) {
  const { student, status, submission } = row;

  return (
    <li className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-6">
      <div className="flex items-start gap-3">
        <Avatar name={student.name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{student.name}</p>
          <p className="truncate text-xs text-muted">{student.email}</p>
          <div className="mt-1.5">{STATUS_BADGE[status]}</div>
        </div>
      </div>

      {submission ? (
        <div className="min-w-0 space-y-2.5 text-sm">
          <p className="text-xs text-muted">Submitted {formatDateTime(submission.submittedAt)}</p>
          <div className="flex flex-wrap gap-2">
            {submission.files.map((f) => (
              <FileChip key={f.id} file={f} />
            ))}
          </div>
          {submission.githubLinks.length > 0 && (
            <ul className="space-y-1">
              {submission.githubLinks.map((link) => (
                <li key={link}>
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex max-w-full items-center gap-1.5 text-xs text-accent hover:underline"
                  >
                    <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{link.replace(/^https?:\/\/(www\.)?/, "")}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {submission.note && <p className="text-xs whitespace-pre-line text-muted">“{submission.note}”</p>}
          <GradePanel submission={submission} totalMarks={totalMarks} onReturned={onReturned} />
        </div>
      ) : (
        <p className="self-center text-sm text-subtle">Nothing uploaded yet.</p>
      )}
    </li>
  );
}
