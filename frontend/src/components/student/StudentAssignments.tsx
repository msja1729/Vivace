"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClassRoom, StudentAssignment } from "@/types";
import { listMyAssignments } from "@/lib/api/assignments";
import { formatDateTime, fromNow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { Badge, EmptyState, Loading, PageHeader } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { ClipboardIcon } from "@/components/ui/Icons";
import { SearchInput, matches } from "@/components/ui/SearchInput";

export function AssignmentStatusBadge({ a }: { a: StudentAssignment }) {
  switch (a.myStatus) {
    case "returned":
      return (
        <Badge tone="success">
          Returned{a.graded && a.submission?.marks != null ? ` · ${a.submission.marks}/${a.totalMarks}` : ""}
        </Badge>
      );
    case "turned_in":
      return <Badge tone="accent">Turned in</Badge>;
    case "missed":
      return <Badge tone="danger">Missed</Badge>;
    default:
      return <Badge tone="warning">Assigned</Badge>;
  }
}

/** A student's assignments: to do first, then done. */
export function StudentAssignments({ cls }: { cls: ClassRoom }) {
  const { data, error } = useLoad(() => listMyAssignments(cls.id), cls.id);
  const [query, setQuery] = useState("");

  const shown = data?.filter((a) => matches(query, a.title, a.instructions)) ?? [];
  const groups = [
    { title: "To do", items: shown.filter((a) => a.myStatus === "assigned") },
    { title: "Turned in", items: shown.filter((a) => a.myStatus === "turned_in" || a.myStatus === "returned") },
    { title: "Missed", items: shown.filter((a) => a.myStatus === "missed") },
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={cls.name} title="Assignments" description="Upload your work and turn it in before the deadline." />
      <FormError message={error} />
      {data === undefined ? (
        !error && <Loading />
      ) : data.length === 0 ? (
        <EmptyState icon={<ClipboardIcon className="h-6 w-6" />} title="No assignments yet" description="Assignments from your instructor will appear here." />
      ) : (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Search assignments" />
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <section key={g.title}>
                  <h2 className="text-sm font-semibold">
                    {g.title} <span className="ml-1 text-subtle">{g.items.length}</span>
                  </h2>
                  <ul className="panel mt-3 divide-y divide-border overflow-hidden rounded-xl">
                    {g.items.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/classes/${cls.id}/assignments/${a.id}`}
                          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-raised"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{a.title}</span>
                            <span className="mt-0.5 block text-xs text-muted">
                              Due {formatDateTime(a.deadline)}
                              {a.isOpen && ` · ${fromNow(a.deadline)}`}
                              {a.graded && ` · ${a.totalMarks} marks`}
                            </span>
                          </span>
                          <AssignmentStatusBadge a={a} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )}
          {shown.length === 0 && <p className="text-center text-sm text-muted">No assignments match “{query}”.</p>}
        </>
      )}
    </div>
  );
}
