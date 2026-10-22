"use client";

import { useEffect } from "react";
import type { ClassRoom, QueueRow, Viva } from "@/types";
import { getExaminerQueue } from "@/lib/api/vivas";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useLoad } from "@/lib/useLoad";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Avatar, Badge, Loading } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { VideoIcon } from "@/components/ui/Icons";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function RowStatus({ r }: { r: QueueRow }) {
  if (r.sessionStatus === "ended")
    return r.score !== null ? <Badge tone="success">Done · {r.score}/10</Badge> : <Badge tone="warning">Ended · needs result</Badge>;
  if (r.sessionStatus === "live") return <Badge tone="success">Live</Badge>;
  if (r.studentOnline) return <Badge tone="accent">In waiting room</Badge>;
  if (r.missed) return <Badge tone="danger">Missed</Badge>;
  if (r.joinedAt) return <Badge>Joined, offline</Badge>;
  return <Badge>Not joined</Badge>;
}

/** Each examiner's students in slot order, with a button into the live room. Refreshes every 10 s. */
export function ExaminerQueue({ cls, viva }: { cls: ClassRoom; viva: Viva }) {
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => getExaminerQueue(viva.id), viva.id);

  useEffect(() => {
    const timer = setInterval(reload, 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (data === undefined) return error ? <FormError message={error} /> : <Loading />;

  const examiners = [...new Map(data.rows.map((r) => [r.examiner.id, r.examiner])).values()].sort((a, b) =>
    a.id === user?.id ? -1 : b.id === user?.id ? 1 : a.name.localeCompare(b.name),
  );

  if (!data.rows.length)
    return (
      <p className="rounded-lg border border-border-strong bg-raised px-4 py-3 text-sm text-muted">
        No students are allocated to you in this viva.
      </p>
    );

  return (
    <div className="space-y-5">
      {data.phase === "draft" && (
        <p className="rounded-lg border border-border-strong bg-raised px-4 py-3 text-sm text-muted">
          Schedule the viva first; students can join the live room from their slot time.
        </p>
      )}
      {examiners.map((e) => {
        const rows = data.rows.filter((r) => r.examiner.id === e.id);
        const mine = e.id === user?.id;
        const done = rows.filter((r) => r.sessionStatus === "ended").length;
        return (
          <Section
            key={e.id}
            title={mine ? "Your students" : `${e.name}'s students`}
            description={`${done} of ${rows.length} done · ${viva.durationMinutes} min each`}
          >
            <ol className="-mx-5 -my-5 divide-y divide-border">
              {rows.map((r) => {
                const canOpen = mine || data.canConductAll;
                const ended = r.sessionStatus === "ended";
                return (
                  <li key={r.student.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="w-24 shrink-0 text-sm tabular-nums" title={formatDateTime(r.startsAt)}>
                      {time(r.startsAt)}
                      <span className="block text-xs text-subtle">entry until {time(r.joinClosesAt)}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={r.student.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.student.name}</span>
                        <span className="block truncate text-xs text-muted">{r.student.email}</span>
                      </span>
                    </span>
                    <RowStatus r={r} />
                    <span className="flex gap-2">
                      {ended && r.sessionId && (
                        <Button size="sm" variant="outline" href={`/classes/${cls.id}/vivas/${viva.id}/report/${r.sessionId}`}>
                          Report
                        </Button>
                      )}
                      {canOpen && (!ended || r.score === null) && !r.missed && (
                        <Button
                          size="sm"
                          variant={r.studentOnline && !ended ? "accent" : "outline"}
                          href={`/classes/${cls.id}/vivas/${viva.id}/room/${r.student.id}`}
                        >
                          <VideoIcon className="h-3.5 w-3.5" /> {ended ? "Enter result" : mine ? "Open room" : "Step in"}
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Section>
        );
      })}
    </div>
  );
}
