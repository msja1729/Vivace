// Small display pieces shared by the app pages.

import { initials } from "@/lib/format";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "border-border-strong text-muted",
  accent: "border-accent/40 bg-accent-soft text-accent",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-medium tracking-wide text-subtle uppercase">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "success" | "warning" | "danger" | "accent";
}) {
  const color = tone ? { success: "text-success", warning: "text-warning", danger: "text-danger", accent: "text-accent" }[tone] : "";
  return (
    <div className="panel rounded-xl p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      {icon && <span className="mb-3 text-subtle">{icon}</span>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Stacked bar, e.g. submitted / late / missing. */
export function ProgressBar({ parts }: { parts: { value: number; className: string; label: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-raised" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
      {total > 0 &&
        parts.map((p) => (p.value ? <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} /> : null))}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="py-16 text-center text-sm text-muted">{label}</p>;
}

export function Avatar({ name, className = "h-8 w-8 text-xs" }: { name: string; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-raised font-semibold text-muted ring-1 ring-border-strong ${className}`}>
      {initials(name)}
    </span>
  );
}
