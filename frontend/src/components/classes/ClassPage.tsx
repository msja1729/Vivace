"use client";

import { isStaff, type ClassRoom, type User } from "@/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/Button";
import { EmptyState, Loading } from "@/components/ui/Display";

/**
 * Wraps a page inside a class: waits for the class to load, handles "not found",
 * and (with `instructorOnly`) keeps students out of the staff pages (instructor and TAs).
 */
export function ClassPage({
  instructorOnly = false,
  children,
}: {
  instructorOnly?: boolean;
  children: (cls: ClassRoom, user: User) => React.ReactNode;
}) {
  const { user } = useAuth();
  const { currentClass } = useWorkspace();

  if (currentClass === undefined || !user) return <Loading />;

  if (currentClass === null || (instructorOnly && !isStaff(currentClass))) {
    return (
      <EmptyState
        title={currentClass === null ? "Class not found" : "Only the class instructor and TAs can see this page"}
        description={currentClass === null ? "It may have been removed, or you're not a member." : undefined}
        action={
          <Button href="/dashboard" variant="outline">
            Back to dashboard
          </Button>
        }
      />
    );
  }

  return <>{children(currentClass, user)}</>;
}
