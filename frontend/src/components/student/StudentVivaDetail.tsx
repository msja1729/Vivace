"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ClassRoom, StudentViva } from "@/types";
import { getMyViva, joinViva } from "@/lib/api/vivas";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { formatCountdown, useNow } from "@/lib/useNow";
import { FileChip } from "@/components/files/FileChip";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Loading, StatTile } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { ChevronLeftIcon, MicIcon } from "@/components/ui/Icons";
import { StudentLiveRoom } from "@/components/live/StudentLiveRoom";
import { VivaStatusBadge, liveStatus } from "./StudentVivas";

/** One viva for a student: when it opens, the Join button (5-minute window), the viva room, and feedback. */
export function StudentVivaDetail({ cls }: { cls: ClassRoom }) {
  const { vivaId } = useParams<{ vivaId: string }>();
  const { data: v, error, setData, reload } = useLoad(() => getMyViva(vivaId), vivaId);
  const now = useNow(1000);

  if (v === undefined) return error ? <FormError message={error} /> : <Loading />;
  const status = liveStatus(v, now);
  const t = (iso: string) => new Date(iso).getTime();
  const staffRun = v.conductedBy === "staff";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/classes/${cls.id}/vivas`} className="inline-flex items-center gap-1 text-xs text-subtle hover:text-text">
          <ChevronLeftIcon className="h-3.5 w-3.5" /> All vivas
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{v.title}</h1>
          <VivaStatusBadge status={status} hasFeedback={!!v.feedback} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={staffRun ? "Your slot" : "Starts"}
          value={<span className="text-base">{formatDateTime(v.startsAt)}</span>}
          hint={v.examiner ? `with ${v.examiner.name}` : undefined}
        />
        <StatTile label="Entry closes" value={<span className="text-base">{formatDateTime(v.joinClosesAt)}</span>} hint={`${v.joinWindowMinutes} min after start`} />
        <StatTile label="Length" value={`${v.durationMinutes} min`} />
        <StatTile
          label="Joined"
          value={<span className="text-base">{v.joinedAt ? new Date(v.joinedAt).toLocaleTimeString() : "–"}</span>}
        />
      </div>

      {status === "upcoming" && (
        <Card className="text-center">
          <p className="text-sm text-muted">The viva opens in</p>
          <p className="mt-1 text-4xl font-bold tabular-nums">{formatCountdown(t(v.startsAt) - now)}</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            Be ready at the start time. You must open the viva within <span className="text-text">{v.joinWindowMinutes} minutes</span>{" "}
            of the start; after that, entry is closed and you&apos;ll be marked as not on time.
          </p>
        </Card>
      )}

      {status === "open" && <JoinCard v={v} now={now} onJoined={setData} />}

      {status === "in_progress" && staffRun && <StudentLiveRoom v={v} onEnded={reload} />}

      {status === "in_progress" && !staffRun && v.myEndsAt && (
        <Card className="space-y-4 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
            <MicIcon className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">You&apos;re in the viva</p>
            <p className="mt-1 text-sm text-muted">Time left</p>
            <p className="text-4xl font-bold tabular-nums">{formatCountdown(t(v.myEndsAt) - now)}</p>
          </div>
          <p className="mx-auto max-w-md rounded-lg border border-border bg-tint px-4 py-3 text-sm text-muted">
            The live viva — camera, microphone and the AI interviewer — connects here. That part is being built next.
          </p>
        </Card>
      )}

      {status === "missed" && (
        <Card className="border-danger/30 bg-danger/[0.06]">
          <p className="font-semibold text-danger">Entry closed</p>
          <p className="mt-1 text-sm text-muted">
            This viva had to be opened within {v.joinWindowMinutes} minutes of the start time ({formatDateTime(v.startsAt)}). You
            didn&apos;t join in time, so you can&apos;t take it, and your report notes that you were not on time.
          </p>
        </Card>
      )}

      {status === "attended" && !v.feedback && (
        <Card className="text-sm text-muted">You attended this viva. Your instructor&apos;s feedback will appear here.</Card>
      )}

      {v.feedback && (
        <section className="rounded-xl border border-success/25 bg-success/[0.06] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-success">Feedback from your instructor</h2>
            {v.feedback.releasedAt && <span className="text-xs text-muted">{formatDateTime(v.feedback.releasedAt)}</span>}
          </div>
          {v.feedback.feedback && <p className="mt-3 text-sm whitespace-pre-line">{v.feedback.feedback}</p>}
          {v.feedback.files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {v.feedback.files.map((f) => (
                <FileChip key={f.id} file={f} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function JoinCard({ v, now, onJoined }: { v: StudentViva; now: number; onJoined: (v: StudentViva) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await joinViva(v.id);
      onJoined(await getMyViva(v.id));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 border-success/30 text-center">
      <p className="text-lg font-semibold">The viva is open</p>
      <div>
        <p className="text-sm text-muted">Entry closes in</p>
        <p className="text-4xl font-bold text-warning tabular-nums">{formatCountdown(new Date(v.joinClosesAt).getTime() - now)}</p>
      </div>
      <Button variant="accent" onClick={join} disabled={busy} className="px-8 py-3 text-base">
        {busy ? "Joining…" : "Join viva now"}
      </Button>
      <FormError message={error} />
    </Card>
  );
}
