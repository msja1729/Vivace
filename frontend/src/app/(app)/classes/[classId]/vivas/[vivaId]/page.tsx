"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { isStaff, type ClassRoom, type Viva } from "@/types";
import { deleteViva, getViva } from "@/lib/api/vivas";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { StudentVivaDetail } from "@/components/student/StudentVivaDetail";
import { PhaseBadge } from "@/components/vivas/PhaseBadge";
import { VivaSetupForm } from "@/components/vivas/VivaSetupForm";
import { VivaStatsPanel } from "@/components/vivas/VivaStatsPanel";
import { ExaminerQueue } from "@/components/live/ExaminerQueue";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Badge, Loading } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { ChartIcon, ChevronLeftIcon, SlidersIcon, TrashIcon, VideoIcon } from "@/components/ui/Icons";

export default function VivaPage() {
  return <ClassPage>{(cls) => (isStaff(cls) ? <VivaWorkspace cls={cls} /> : <StudentVivaDetail cls={cls} />)}</ClassPage>;
}

type Tab = "room" | "stats" | "setup";

function VivaWorkspace({ cls }: { cls: ClassRoom }) {
  const { vivaId } = useParams<{ vivaId: string }>();
  const { data: viva, error, setData } = useLoad(() => getViva(vivaId), vivaId);

  if (viva === undefined) return error ? <FormError message={error} /> : <Loading />;
  // Keyed by id so switching vivas resets the form and tab.
  return <VivaView key={viva.id} cls={cls} viva={viva} onChange={setData} />;
}

function VivaView({ cls, viva, onChange }: { cls: ClassRoom; viva: Viva; onChange: (v: Viva) => void }) {
  const router = useRouter();
  const staffRun = viva.conductedBy === "staff" && viva.status === "scheduled";
  // Drafts open on Setup; staff-run vivas that are on (or coming up) open on the live room; the rest on statistics.
  const [tab, setTab] = useState<Tab>(
    viva.phase === "draft" ? "setup" : staffRun && viva.phase !== "closed" ? "room" : "stats",
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const tabs: { value: Tab; label: string; icon: React.ReactNode }[] = [
    ...(staffRun ? [{ value: "room" as Tab, label: "Live room", icon: <VideoIcon /> }] : []),
    { value: "stats", label: "Summary statistics", icon: <ChartIcon /> },
    { value: "setup", label: "Setup", icon: <SlidersIcon /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/classes/${cls.id}/vivas`}
          className="inline-flex items-center gap-1 text-xs text-subtle transition hover:text-text"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" /> All vivas
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{viva.title}</h1>
              <PhaseBadge phase={viva.phase} />
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge>{viva.audience === "whole_class" ? "Whole class" : "Selected students"}</Badge>
              <Badge tone="accent">{viva.conductedBy === "staff" ? "Instructor & TAs" : "AI examiner"}</Badge>
              {viva.studentCount} student{viva.studentCount === 1 ? "" : "s"}
              {viva.startsAt && <span>· Starts {formatDateTime(viva.startsAt)}</span>}
              {viva.startsAt && (
                <span>
                  · Entry closes {viva.joinWindowMinutes} min after {viva.conductedBy === "staff" ? "each slot" : "start"}
                </span>
              )}
            </p>
          </div>
          {viva.phase !== "live" && (
            <ConfirmButton
              label="Delete viva"
              icon={<TrashIcon />}
              onConfirm={async () => {
                try {
                  await deleteViva(viva.id);
                  router.push(`/classes/${cls.id}/vivas`);
                } catch (err) {
                  setDeleteError((err as Error).message);
                }
              }}
            />
          )}
        </div>
        <div className="mt-3">
          <FormError message={deleteError} />
        </div>
      </div>

      {/* Top bar: summary statistics | setup */}
      <div role="tablist" aria-label="Viva sections" className="panel flex gap-1 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
              tab === t.value ? "bg-raised text-text shadow-sm ring-1 ring-border-strong" : "text-muted hover:text-text"
            }`}
          >
            <span className={tab === t.value ? "text-accent" : ""}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "room" && <ExaminerQueue cls={cls} viva={viva} />}
      {/* Both stay mounted so unsaved setup edits survive a look at the statistics. */}
      <div hidden={tab !== "stats"}>{tab === "stats" && <VivaStatsPanel viva={viva} />}</div>
      <div hidden={tab !== "setup"}>
        <VivaSetupForm viva={viva} onSaved={onChange} onFilesChange={(files) => onChange({ ...viva, files })} />
      </div>
    </div>
  );
}
