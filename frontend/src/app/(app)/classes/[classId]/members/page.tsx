"use client";

import { useState } from "react";
import type { ClassRoom } from "@/types";
import { listMembers } from "@/lib/api/classes";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { useWorkspace } from "@/lib/workspace";
import { ClassPage } from "@/components/classes/ClassPage";
import { JoinCode } from "@/components/classes/JoinCode";
import { TeachingStaff } from "@/components/classes/TeachingStaff";
import { Avatar, EmptyState, Loading, PageHeader } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { UsersIcon } from "@/components/ui/Icons";
import { SearchInput, matches } from "@/components/ui/SearchInput";

export default function MembersPage() {
  return <ClassPage instructorOnly>{(cls) => <Members cls={cls} />}</ClassPage>;
}

function Members({ cls }: { cls: ClassRoom }) {
  const { data: members, error, reload } = useLoad(() => listMembers(cls.id), cls.id);
  const { refreshClasses } = useWorkspace();
  const [query, setQuery] = useState("");
  const shown = members?.filter((m) => matches(query, m.name, m.email));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={cls.name}
        title="Team members"
        description={members ? `${members.length} student${members.length === 1 ? "" : "s"} in this class.` : undefined}
        actions={cls.joinCode && <JoinCode code={cls.joinCode} />}
      />

      {/* A student made TA leaves the student list (and comes back when removed). */}
      <TeachingStaff
        cls={cls}
        onChange={() => {
          reload();
          refreshClasses();
        }}
      />

      <FormError message={error} />
      {members === undefined ? (
        !error && <Loading />
      ) : members.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-6 w-6" />}
          title="No students yet"
          description="Share the join code above. Students appear here as soon as they join."
        />
      ) : (
        <div className="panel overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
            <h2 className="px-2 text-sm font-semibold">Students</h2>
            <SearchInput value={query} onChange={setQuery} placeholder="Search students by name or email" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">Student</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown!.map((m, i) => (
                  <tr key={m.id} className="hover:bg-raised/50">
                    <td className="px-4 py-3 text-subtle tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        <Avatar name={m.name} />
                        <span className="font-medium">{m.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{m.email}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(m.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown!.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No students match “{query}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
