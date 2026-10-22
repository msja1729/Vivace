import { Card } from "@/components/ui/Card";

/** Register / log in layout: a featured gradient card beside the form (form only on phones). */
export function AuthFrame({
  eyebrow,
  title,
  description,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl items-stretch gap-6 py-10 sm:py-16 lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="featured relative hidden overflow-hidden rounded-3xl p-8 lg:flex lg:flex-col lg:justify-between">
        <span className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <p className="text-[11px] font-semibold tracking-[0.2em] text-white/70 uppercase">AI oral exams</p>
        <div>
          <h2 className="text-3xl leading-tight font-semibold">Test real understanding, not memorised answers.</h2>
          <p className="mt-3 text-sm text-white/75">
            Every student is asked about their own projects and graded on your criteria, with an honest report at the
            end.
          </p>
        </div>
        <ul className="space-y-2 text-sm text-white/85">
          <li>• Live AI follow-up questions</li>
          <li>• Proctoring with few false alarms</li>
          <li>• Per-student and class reports</li>
        </ul>
      </aside>

      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-subtle uppercase">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">{description}</p>
        <Card className="mt-6 rounded-3xl p-6 sm:p-7">{children}</Card>
        {footer && <p className="mt-5 text-center text-sm text-muted">{footer}</p>}
      </div>
    </div>
  );
}
