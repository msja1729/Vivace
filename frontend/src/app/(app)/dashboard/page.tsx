"use client";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useWorkspace } from "@/lib/workspace";
import { ActionCard } from "@/components/dashboard/ActionCard";
import { ClassList } from "@/components/dashboard/ClassList";
import { FormError } from "@/components/ui/Field";
import { Loading, PageHeader } from "@/components/ui/Display";
import { DoorIcon, PlusIcon } from "@/components/ui/Icons";

export default function DashboardPage() {
  const { user } = useAuth();
  const { myClasses, classesError } = useWorkspace();
  if (!user) return null;
  const isInstructor = user.role === "instructor";

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={`${user.role} dashboard`} title={`Hi, ${user.name.split(" ")[0]}`} />

      {/* Instructors: Create + Join. Students: Join only. */}
      <div className="grid gap-3 md:grid-cols-2">
        {isInstructor && (
          <ActionCard
            href="/classes/create"
            icon={<PlusIcon className="h-5 w-5" />}
            title="Create a class"
            description="Set up a class and share its join code."
          />
        )}
        <ActionCard
          href="/classes/join"
          icon={<DoorIcon className="h-5 w-5" />}
          title="Join a class"
          description="Enter a code someone shared with you."
        />
      </div>

      <FormError message={classesError} />

      {myClasses ? (
        <div className="space-y-10">
          {isInstructor && (
            <ClassList title="Classes you teach" classes={myClasses.teaching} empty="You haven't created a class yet." />
          )}
          {myClasses.assisting.length > 0 && (
            <ClassList title="Classes you assist (TA)" classes={myClasses.assisting} empty="" />
          )}
          <ClassList title="Classes you've joined" classes={myClasses.joined} empty="You haven't joined a class yet." />
        </div>
      ) : (
        !classesError && <Loading />
      )}
    </div>
  );
}
