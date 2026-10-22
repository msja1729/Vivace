"use client";

import { useRouter } from "next/navigation";
import { createAssignment } from "@/lib/api/assignments";
import { ClassPage } from "@/components/classes/ClassPage";
import { AssignmentForm } from "@/components/assignments/AssignmentForm";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Display";

export default function NewAssignmentPage() {
  const router = useRouter();
  return (
    <ClassPage instructorOnly>
      {(cls) => (
        <div className="max-w-2xl space-y-6">
          <PageHeader
            eyebrow={cls.name}
            title="New assignment"
            description={`Every student in the class (${cls.memberCount}) will be asked to upload by the deadline.`}
          />
          <Card>
            <AssignmentForm
              submitLabel="Send to class"
              onSubmit={async (input) => {
                const a = await createAssignment(cls.id, input);
                router.push(`/classes/${cls.id}/assignments/${a.id}`);
              }}
              onCancel={() => router.back()}
            />
          </Card>
        </div>
      )}
    </ClassPage>
  );
}
