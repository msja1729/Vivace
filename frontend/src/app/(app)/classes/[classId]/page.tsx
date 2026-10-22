"use client";

import Link from "next/link";
import { isStaff, type ClassRoom } from "@/types";
import { listAssignments, listMyAssignments } from "@/lib/api/assignments";
import { listMyVivas, listVivas } from "@/lib/api/vivas";
import { useNow } from "@/lib/useNow";
import { VivaStatusBadge, liveStatus } from "@/components/student/StudentVivas";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { JoinCode } from "@/components/classes/JoinCode";
import { Card, Section } from "@/components/ui/Card";
import { PageHeader, StatTile } from "@/components/ui/Display";
import { CheckIcon } from "@/components/ui/Icons";
import { PhaseBadge } from "@/components/vivas/PhaseBadge";
import { formatDateTime, fromNow } from "@/lib/format";

export default function ClassOverviewPage() {
  return (
    <ClassPage>
      {(cls) => (isStaff(cls) ? <InstructorOverview cls={cls} /> : <StudentOverview cls={cls} />)}
    </ClassPage>
  );
}

function InstructorOverview({ cls }: { cls: ClassRoom }) {
  const assignments = useLoad(() => listAssignments(cls.id), cls.id);
  const vivas = useLoad(() => listVivas(cls.id), cls.id);
  const base = `/classes/${cls.id}`;

  const openAssignments = assignments.data?.filter((a) => a.isOpen).length ?? 0;
  const activeVivas = vivas.data?.filter((v) => v.phase === "upcoming" || v.phase === "live").length ?? 0;

  // The instructor's flow: invite students → collect resumes → set up a viva.
  const steps = [
    { done: cls.memberCount > 0, title: "Invite students", text: "Share the join code with your class.", href: `${base}/members` },
    {
      done: (assignments.data?.length ?? 0) > 0,
      title: "Collect resumes & projects",
      text: "Send an upload assignment with a deadline.",
      href: `${base}/assignments/new`,
    },
    {
      done: (vivas.data?.some((v) => v.status === "scheduled") ?? false),
      title: "Set up and schedule a viva",
      text: "Tell the AI how to interview and grade.",
      href: `${base}/vivas`,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={cls.subject}
        title={cls.name}
        description={cls.description || undefined}
        actions={cls.joinCode && <JoinCode code={cls.joinCode} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Students" value={cls.memberCount} />
        <StatTile label="Assignments" value={assignments.data?.length ?? "–"} hint={`${openAssignments} open`} />
        <StatTile label="Vivas" value={vivas.data?.length ?? "–"} hint={`${activeVivas} upcoming or live`} />
        <StatTile label="Created" value={<span className="text-base">{new Date(cls.createdAt).toLocaleDateString()}</span>} />
      </div>

      <Card className="p-0">
        <ol className="divide-y divide-border">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Link href={s.href} className="flex items-center gap-4 px-5 py-4 transition hover:bg-raised">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    s.done ? "bg-success/15 text-success" : "bg-raised text-muted ring-1 ring-border-strong"
                  }`}
                >
                  {s.done ? <CheckIcon /> : i + 1}
                </span>
                <span className="flex-1">
                  <span className={`block text-sm font-medium ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
                  <span className="block text-xs text-muted">{s.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Recent assignments" actions={<Link href={`${base}/assignments`} className="text-xs text-muted hover:text-text">View all</Link>}>
          {assignments.data?.length ? (
            <ul className="space-y-3">
              {assignments.data.slice(0, 4).map((a) => (
                <li key={a.id}>
                  <Link href={`${base}/assignments/${a.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-accent">
                    <span className="truncate">{a.title}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {a.submittedCount}/{a.totalStudents} submitted
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No assignments yet.</p>
          )}
        </Section>
        <Section title="Vivas" actions={<Link href={`${base}/vivas`} className="text-xs text-muted hover:text-text">View all</Link>}>
          {vivas.data?.length ? (
            <ul className="space-y-3">
              {vivas.data.slice(0, 4).map((v) => (
                <li key={v.id}>
                  <Link href={`${base}/vivas/${v.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-accent">
                    <span className="truncate">{v.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                      {v.startsAt && v.phase !== "draft" && fromNow(v.startsAt)}
                      <PhaseBadge phase={v.phase} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No vivas yet.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function StudentOverview({ cls }: { cls: ClassRoom }) {
  const assignments = useLoad(() => listMyAssignments(cls.id), cls.id);
  const vivas = useLoad(() => listMyVivas(cls.id), cls.id);
  const now = useNow(5000);
  const base = `/classes/${cls.id}`;

  const toDo = assignments.data?.filter((a) => a.myStatus === "assigned") ?? [];
  const returned = assignments.data?.filter((a) => a.myStatus === "returned") ?? [];
  const nextVivas =
    vivas.data?.filter((v) => ["upcoming", "open", "in_progress"].includes(liveStatus(v, now))) ?? [];

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={cls.subject} title={cls.name} description={`Instructor: ${cls.instructorName}`} />
      {cls.description && <Card className="text-sm text-muted">{cls.description}</Card>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Assignments to do" value={assignments.data ? toDo.length : "–"} tone={toDo.length ? "warning" : undefined} />
        <StatTile label="Returned to you" value={assignments.data ? returned.length : "–"} />
        <StatTile label="Upcoming vivas" value={vivas.data ? nextVivas.length : "–"} tone={nextVivas.length ? "accent" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="To do" actions={<Link href={`${base}/assignments`} className="text-xs text-muted hover:text-text">All assignments</Link>}>
          {toDo.length ? (
            <ul className="space-y-3">
              {toDo.map((a) => (
                <li key={a.id}>
                  <Link href={`${base}/assignments/${a.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-accent">
                    <span className="truncate">{a.title}</span>
                    <span className="shrink-0 text-xs text-warning">due {fromNow(a.deadline)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing due. 🎉</p>
          )}
        </Section>
        <Section title="Vivas" actions={<Link href={`${base}/vivas`} className="text-xs text-muted hover:text-text">All vivas</Link>}>
          {nextVivas.length ? (
            <ul className="space-y-3">
              {nextVivas.map((v) => (
                <li key={v.id}>
                  <Link href={`${base}/vivas/${v.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-accent">
                    <span className="truncate">{v.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                      {formatDateTime(v.startsAt)}
                      <VivaStatusBadge status={liveStatus(v, now)} hasFeedback={!!v.feedback} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No upcoming vivas.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
