export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`panel rounded-xl p-5 ${className}`}>{children}</div>;
}

/** Card with a titled header row (optional actions on the right). */
export function Section({
  title,
  description,
  actions,
  className = "",
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel rounded-xl ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
