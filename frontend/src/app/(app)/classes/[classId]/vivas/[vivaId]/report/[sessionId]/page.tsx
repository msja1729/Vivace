"use client";

import { useParams } from "next/navigation";
import { getSessionReport } from "@/lib/api/vivas";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { SessionReportView } from "@/components/live/SessionReportView";
import { Loading } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";

/** One student's viva report: summary, integrity timeline, per-answer breakdown, transcript. */
export default function SessionReportPage() {
  return <ClassPage instructorOnly>{() => <Report />}</ClassPage>;
}

function Report() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data, error } = useLoad(() => getSessionReport(sessionId), sessionId);
  if (data === undefined) return error ? <FormError message={error} /> : <Loading />;
  return <SessionReportView report={data} />;
}
