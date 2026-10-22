"use client";

import { useState } from "react";
import type { Role } from "@/types";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { BoardIcon, GraduationIcon } from "@/components/ui/Icons";

const ROLES: { value: Role; title: string; icon: React.ReactNode; abilities: string[] }[] = [
  {
    value: "student",
    title: "Student",
    icon: <GraduationIcon />,
    abilities: ["Join a class with a code", "Turn in assignments", "Take vivas and get feedback"],
  },
  {
    value: "instructor",
    title: "Instructor",
    icon: <BoardIcon />,
    abilities: ["Create classes & vivas", "Collect resumes & projects", "Join a class"],
  },
];

export function RoleSelector({ onConfirm }: { onConfirm: (role: Role) => Promise<void> }) {
  const [selected, setSelected] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="Choose your role" className="grid gap-4 sm:grid-cols-2">
        {ROLES.map((r) => {
          const active = selected === r.value;
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(r.value)}
              className={`flex flex-col items-start rounded-xl border bg-white/[0.03] p-5 text-left transition hover:bg-raised ${
                active ? "border-accent ring-2 ring-accent/30" : "border-border-strong"
              }`}
            >
              <span className={active ? "text-accent" : "text-muted"}>{r.icon}</span>
              <h3 className="mt-3 text-lg font-semibold">{r.title}</h3>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {r.abilities.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      <FormError message={error} />
      <Button className="w-full" disabled={!selected || busy} onClick={confirm}>
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
