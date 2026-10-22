import Link from "next/link";
import type { ClassRoom } from "@/types";
import { UsersIcon } from "@/components/ui/Icons";

export function ClassList({ title, classes, empty }: { title: string; classes: ClassRoom[]; empty: string }) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      {classes.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/classes/${c.id}`}
                className="panel flex h-full flex-col rounded-xl p-4 transition hover:border-border-strong hover:bg-raised"
              >
                <span className="text-xs text-subtle">{c.subject}</span>
                <span className="mt-1 font-semibold">{c.name}</span>
                <span className="mt-auto flex items-center justify-between pt-4 text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <UsersIcon className="h-3.5 w-3.5" /> {c.memberCount} student{c.memberCount === 1 ? "" : "s"}
                  </span>
                  {c.joinCode ? <span className="font-mono tracking-widest">{c.joinCode}</span> : <span>by {c.instructorName}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
