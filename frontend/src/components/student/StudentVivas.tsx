"use client";

import Link from "next/link";
import type { ClassRoom, StudentViva } from "@/types";
import { listMyVivas } from "@/lib/api/vivas";
import { formatDateTime, fromNow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { useNow } from "@/lib/useNow";
import { Badge, EmptyState, Loading, PageHeader } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { MicIcon } from "@/components/ui/Icons";

/**
 * The student's status, moved forward by the clock so the page doesn't need reloading:
 * upcoming → open at the start time → missed when the join window closes (if they never joined),
 * in_progress → attended when their time is up.
 */
export function liveStatus(v: StudentViva, now: number): StudentViva["myStatus"] {
  const t = (iso: string) => new Date(iso).getTime();
  if (v.myStatus === "upcoming" && now >= t(v.startsAt)) return now <= t(v.joinClosesAt) ? "open" : "missed";
  if (v.myStatus === "open" && now > t(v.joinClosesAt)) return "missed";
  // Staff-run vivas end when the examiner ends them, not on a timer.
  if (v.myStatus === "in_progress" && v.conductedBy !== "staff" && v.myEndsAt && now >= t(v.myEndsAt)) return "attended";
  return v.myStatus;
}

export function VivaStatusBadge({ status, hasFeedback }: { status: StudentViva["myStatus"]; hasFeedback: boolean }) {
  if (hasFeedback) return <Badge tone="success">Feedback ready</Badge>;
  switch (status) {
    case "open":
      return <Badge tone="success">Open now</Badge>;
    case "in_progress":
      return <Badge tone="accent">In progress</Badge>;
    case "attended":
      return <Badge>Attended</Badge>;
    case "missed":
      return <Badge tone="danger">Missed: not on time</Badge>;
    default:
      return <Badge tone="accent">Scheduled</Badge>;
  }
}

export function StudentVivas({ cls }: { cls: ClassRoom }) {
  const { data, error } = useLoad(() => listMyVivas(cls.id), cls.id);
  const now = useNow(5000);

  const withStatus = data?.map((v) => ({ v, status: liveStatus(v, now) })) ?? [];
  const groups = [
    { title: "Open now", items: withStatus.filter((x) => x.status === "open" || x.status === "in_progress") },
    { title: "Upcoming", items: withStatus.filter((x) => x.status === "upcoming") },
    { title: "Past vivas", items: withStatus.filter((x) => x.status === "attended" || x.status === "missed") },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={cls.name}
        title="Vivas"
        description="Your scheduled vivas. Open each one within 5 minutes of its start time — after that, entry closes."
      />
      <FormError message={error} />
      {data === undefined ? (
        !error && <Loading />
      ) : data.length === 0 ? (
        <EmptyState icon={<MicIcon className="h-6 w-6" />} title="No vivas scheduled" description="Vivas from your instructor will appear here." />
      ) : (
        groups.map(
          (g) =>
            g.items.length > 0 && (
              <section key={g.title}>
                <h2 className="text-sm font-semibold">{g.title}</h2>
                <ul className="panel mt-3 divide-y divide-border overflow-hidden rounded-xl">
                  {g.items.map(({ v, status }) => (
                    <li key={v.id}>
                      <Link
                        href={`/classes/${cls.id}/vivas/${v.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-raised"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{v.title}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {formatDateTime(v.startsAt)} · {fromNow(v.startsAt)} · {v.durationMinutes} min
                          </span>
                        </span>
                        <VivaStatusBadge status={status} hasFeedback={!!v.feedback} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )
      )}
    </div>
  );
}
