"use client";

import { useParams } from "next/navigation";
import type { ClassRoom } from "@/types";
import { getViva } from "@/lib/api/vivas";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { ExaminerConsole } from "@/components/live/ExaminerConsole";
import { EmptyState, Loading } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";

/** Examiner's live room for one student of a staff-run viva. */
export default function ExaminerRoomPage() {
  return <ClassPage instructorOnly>{(cls) => <Room cls={cls} />}</ClassPage>;
}

function Room({ cls }: { cls: ClassRoom }) {
  const { vivaId, studentId } = useParams<{ vivaId: string; studentId: string }>();
  const { data: viva, error } = useLoad(() => getViva(vivaId), vivaId);

  if (viva === undefined) return error ? <FormError message={error} /> : <Loading />;
  const slot = viva.slots.find((s) => s.student.id === studentId);
  if (!slot || viva.conductedBy !== "staff")
    return <EmptyState title="Student not found" description="This student has no slot in this viva." />;
  return <ExaminerConsole key={studentId} cls={cls} viva={viva} student={slot.student} />;
}
