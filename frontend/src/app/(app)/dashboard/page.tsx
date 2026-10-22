"use client";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useWorkspace } from "@/lib/workspace";
import { ActionCard } from "@/components/dashboard/ActionCard";
import { ClassList } from "@/components/dashboard/ClassList";
import { FormError } from "@/components/ui/Field";
import { Loading } from "@/components/ui/Display";
import { DoorIcon, PlusIcon } from "@/components/ui/Icons";

export default function DashboardPage() {
  const { user } = useAuth();
  const { myClasses, classesError } = useWorkspace();
  if (!user) return null;
  const isInstructor = user.role === "instructor";

  return (
    <div className="space-y-10">
      <header className="featured relative overflow-hidden rounded-3xl px-6 py-7 sm:px-8">
        <span className="pointer-events-none absolute -top-12 right-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <p className="text-[11px] font-semibold tracking-[0.2em] text-white/70 uppercase">{user.role} dashboard</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Hi, {user.name.split(" ")[0]}</h1>
        <p className="mt-1.5 text-sm text-white/75">
          {isInstructor ? "Create a class, set up vivas and review reports." : "Join your classes and take your vivas here."}
        </p>
      </header>

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
