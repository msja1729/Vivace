"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isStaff, type ClassRoom, type VivaAudience, type VivaSummary } from "@/types";
import { createViva, listVivas } from "@/lib/api/vivas";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { StudentVivas } from "@/components/student/StudentVivas";
import { PhaseBadge } from "@/components/vivas/PhaseBadge";
import { Loading, PageHeader } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { CalendarIcon, ChevronRightIcon, UsersIcon } from "@/components/ui/Icons";

export default function VivasPage() {
  return <ClassPage>{(cls) => (isStaff(cls) ? <Vivas cls={cls} /> : <StudentVivas cls={cls} />)}</ClassPage>;
}

const CREATE_OPTIONS: { audience: VivaAudience; title: string; text: string; icon: React.ReactNode }[] = [
  {
    audience: "whole_class",
    title: "For the whole class",
    text: "Every student in the class takes this viva.",
    icon: <UsersIcon className="h-5 w-5" />,
  },
  {
    audience: "selected",
    title: "For specific students",
    text: "Pick the students, e.g. a re-take or one project group.",
    icon: <CalendarIcon className="h-5 w-5" />,
  },
];

function Vivas({ cls }: { cls: ClassRoom }) {
  const router = useRouter();
  const { data, error } = useLoad(() => listVivas(cls.id), cls.id);
  const [creating, setCreating] = useState<VivaAudience | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  async function start(audience: VivaAudience) {
    setCreating(audience);
    setCreateError(null);
    try {
      const viva = await createViva(cls.id, audience);
      router.push(`/classes/${cls.id}/vivas/${viva.id}`);
    } catch (err) {
      setCreateError((err as Error).message);
      setCreating(null);
    }
  }

  const groups: { title: string; items: VivaSummary[]; empty: string }[] = [
    { title: "Drafts", items: data?.filter((v) => v.phase === "draft") ?? [], empty: "No drafts." },
    {
      title: "Scheduled & live",
      items: data?.filter((v) => v.phase === "upcoming" || v.phase === "live") ?? [],
      empty: "Nothing scheduled.",
    },
    { title: "Previous vivas", items: data?.filter((v) => v.phase === "closed") ?? [], empty: "No vivas have finished yet." },
  ];

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={cls.name} title="Vivas" description="Create, schedule and review AI vivas for this class." />

      <section>
        <h2 className="text-sm font-semibold">Create & schedule a viva</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {CREATE_OPTIONS.map((o) => (
            <button
              key={o.audience}
              type="button"
              disabled={creating !== null}
              onClick={() => start(o.audience)}
              className="panel group flex items-start gap-4 rounded-xl p-5 text-left transition hover:border-border-strong hover:bg-raised disabled:opacity-60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{o.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{creating === o.audience ? "Creating…" : o.title}</span>
                <span className="mt-0.5 block text-sm text-muted">{o.text}</span>
              </span>
              <ChevronRightIcon className="mt-1 h-4 w-4 text-subtle transition group-hover:translate-x-0.5 group-hover:text-text" />
            </button>
          ))}
        </div>
        <div className="mt-3">
          <FormError message={createError} />
        </div>
      </section>

      <FormError message={error} />
      {data === undefined ? (
        !error && <Loading />
      ) : (
        groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-sm font-semibold">
              {g.title} <span className="ml-1 text-subtle">{g.items.length}</span>
            </h2>
            {g.items.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{g.empty}</p>
            ) : (
              <ul className="panel mt-3 divide-y divide-border overflow-hidden rounded-xl">
                {g.items.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`/classes/${cls.id}/vivas/${v.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-raised"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{v.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {v.audience === "whole_class" ? "Whole class" : "Selected students"} · {v.studentCount} student
                          {v.studentCount === 1 ? "" : "s"}
                          {v.startsAt && ` · ${formatDateTime(v.startsAt)}`}
                        </span>
                      </span>
                      <PhaseBadge phase={v.phase} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
