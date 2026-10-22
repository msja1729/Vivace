"use client";

// What the signed-in app is looking at: the user's classes (for the sidebar) and
// the class in the URL, if any. Loaded once here and shared by the sidebar and pages.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ClassRoom } from "@/types";
import { getClass, listMyClasses, type MyClasses } from "@/lib/api/classes";

interface WorkspaceValue {
  classId: string | undefined;
  /** undefined = loading, null = not found / no access */
  currentClass: ClassRoom | null | undefined;
  myClasses: MyClasses | null;
  classesError: string | null;
  refreshClasses: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { classId } = useParams<{ classId?: string }>();
  const [loaded, setLoaded] = useState<{ id: string; cls: ClassRoom | null } | null>(null);
  const [myClasses, setMyClasses] = useState<MyClasses | null>(null);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    listMyClasses().then(
      (res) => {
        setMyClasses(res);
        setClassesError(null);
      },
      (err: Error) => setClassesError(err.message),
    );
  }, [version]);

  useEffect(() => {
    if (!classId) return;
    getClass(classId).then(
      (cls) => setLoaded({ id: classId, cls }),
      () => setLoaded({ id: classId, cls: null }),
    );
  }, [classId, version]);

  const refreshClasses = useCallback(() => setVersion((v) => v + 1), []);
  const currentClass = !classId ? null : loaded?.id === classId ? loaded.cls : undefined;

  return (
    <WorkspaceContext.Provider value={{ classId, currentClass, myClasses, classesError, refreshClasses }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
