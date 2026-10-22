"use client";

import { useState } from "react";
import Link from "next/link";
import { isStaff, type ClassRoom } from "@/types";
import { listAssignments } from "@/lib/api/assignments";
import { formatDateTime, fromNow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { StudentAssignments } from "@/components/student/StudentAssignments";
import { SubmissionProgress } from "@/components/assignments/SubmissionProgress";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, Loading, PageHeader } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { ClipboardIcon, PlusIcon } from "@/components/ui/Icons";
import { SearchInput, matches } from "@/components/ui/SearchInput";

export default function AssignmentsPage() {
  return <ClassPage>{(cls) => (isStaff(cls) ? <Assignments cls={cls} /> : <StudentAssignments cls={cls} />)}</ClassPage>;
}

function Assignments({ cls }: { cls: ClassRoom }) {
  const { data, error } = useLoad(() => listAssignments(cls.id), cls.id);
  const base = `/classes/${cls.id}/assignments`;
  const [query, setQuery] = useState("");
  const shown = data?.filter((a) => matches(query, a.title, a.instructions)) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={cls.name}
        title="Assignments"
        description="Ask the class to upload resumes, GitHub links and Claude transcripts before a viva."
        actions={
          <Button href={`${base}/new`}>
            <PlusIcon /> New assignment
          </Button>
        }
      />
      <FormError message={error} />

      {data === undefined ? (
        !error && <Loading />
      ) : data.length === 0 ? (
        <EmptyState
          icon={<ClipboardIcon className="h-6 w-6" />}
          title="No assignments yet"
          description="Start by asking students for their resumes and project links. The viva uses them to ask about each student's own work."
          action={<Button href={`${base}/new`}>Create the first assignment</Button>}
        />
      ) : (
        <div className="space-y-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search assignments" />
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted">No assignments match “{query}”.</p>}
        <ul className="space-y-3">
          {shown.map((a) => (
            <li key={a.id}>
              <Link href={`${base}/${a.id}`} className="panel block rounded-xl p-5 transition hover:border-border-strong hover:bg-raised">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Due {formatDateTime(a.deadline)} · {fromNow(a.deadline)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums">
                      <span className="font-semibold">{a.submittedCount}</span>
                      <span className="text-muted">/{a.totalStudents} submitted</span>
                    </span>
                    {a.graded && <Badge tone="accent">{a.totalMarks} marks</Badge>}
                    {a.isOpen ? <Badge tone="success">Open</Badge> : <Badge>Closed</Badge>}
                  </div>
                </div>
                <div className="mt-4">
                  <SubmissionProgress a={a} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        </div>
      )}
    </div>
  );
}
