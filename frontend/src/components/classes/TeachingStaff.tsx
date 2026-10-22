"use client";

import { useEffect, useState } from "react";
import type { ClassRoom, Person, TA } from "@/types";
import { addTA, listTAs, removeTA, searchTACandidates } from "@/lib/api/classes";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Avatar, Badge } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { PlusIcon } from "@/components/ui/Icons";
import { SearchInput } from "@/components/ui/SearchInput";

/**
 * The class owner and TAs. TAs get the instructor's powers in this class.
 * Only the owner can add (by searching any registered user's email) or remove TAs.
 */
export function TeachingStaff({ cls, onChange }: { cls: ClassRoom; onChange: () => void }) {
  const isOwner = cls.myRole === "owner";
  const { data: tas, error, setData } = useLoad(() => listTAs(cls.id), cls.id);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(ta: TA) {
    setActionError(null);
    try {
      await removeTA(cls.id, ta.id);
      setData((tas ?? []).filter((t) => t.id !== ta.id));
      onChange();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <Section
      title="Teaching staff"
      description="TAs have the same permissions as the instructor in this class, except managing TAs."
      actions={
        isOwner &&
        !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon className="h-3.5 w-3.5" /> Add TA
          </Button>
        )
      }
    >
      {adding && (
        <AddTA
          classId={cls.id}
          onAdded={(list) => {
            setData(list);
            setAdding(false);
            onChange();
          }}
          onClose={() => setAdding(false)}
        />
      )}
      <FormError message={error ?? actionError} />

      <ul className="divide-y divide-border">
        <li className="flex items-center gap-3 py-3 first:pt-0">
          <Avatar name={cls.instructorName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{cls.instructorName}</span>
          </span>
          <Badge tone="accent">Instructor</Badge>
        </li>
        {tas?.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
            <Avatar name={t.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t.name}</span>
              <span className="block truncate text-xs text-muted">
                {t.email} · added {formatDate(t.addedAt)}
              </span>
            </span>
            <Badge>TA</Badge>
            {isOwner && <ConfirmButton size="sm" label="Remove" confirmLabel="Yes, remove" onConfirm={() => remove(t)} />}
          </li>
        ))}
      </ul>
      {tas?.length === 0 && !adding && (
        <p className="mt-2 text-sm text-muted">{isOwner ? "No TAs yet. Add one by their email." : "No TAs."}</p>
      )}
    </Section>
  );
}

function AddTA({ classId, onAdded, onClose }: { classId: string; onAdded: (tas: TA[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; people: Person[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search as you type, after a short pause.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const timer = setTimeout(() => {
      searchTACandidates(classId, q).then(
        (people) => setResults({ query: q, people }),
        (err: Error) => setError(err.message),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [classId, query]);

  async function add(person: Person) {
    setBusyId(person.id);
    setError(null);
    try {
      onAdded(await addTA(classId, person.id));
    } catch (err) {
      setError((err as Error).message);
      setBusyId(null);
    }
  }

  const q = query.trim();
  const shown = q.length >= 3 && results?.query === q ? results.people : null;

  return (
    <div className="mb-4 rounded-xl border border-border bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search by IISc email or name" className="max-w-sm" />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="mt-2 text-xs text-subtle">
        Anyone who has signed in to VIVA.AI can be a TA, even if they aren&apos;t in this class.
      </p>
      {error && (
        <div className="mt-3">
          <FormError message={error} />
        </div>
      )}
      {q.length > 0 && q.length < 3 && <p className="mt-3 text-sm text-muted">Type at least 3 characters.</p>}
      {shown && shown.length === 0 && (
        <p className="mt-3 text-sm text-muted">No registered user matches “{q}”. They need to sign in once first.</p>
      )}
      {shown && shown.length > 0 && (
        <ul className="mt-3 space-y-1">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-raised">
              <Avatar name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted">{p.email}</span>
              </span>
              <Button size="sm" disabled={busyId !== null} onClick={() => add(p)}>
                {busyId === p.id ? "Adding…" : "Add as TA"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
