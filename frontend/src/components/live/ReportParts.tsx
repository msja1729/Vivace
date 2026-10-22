// Report pieces shared by the examiner's report and the student's view of what was sent to them.

import type { AiReport, ReleasedMarks, Understanding } from "@/types";
import { Badge } from "@/components/ui/Display";

const VERDICT: Record<AiReport["verdict"], { label: string; tone: "success" | "accent" | "warning" | "danger" | "neutral" }> = {
  strong: { label: "Strong understanding", tone: "success" },
  good: { label: "Good understanding", tone: "success" },
  partial: { label: "Partial understanding", tone: "warning" },
  weak: { label: "Weak understanding", tone: "danger" },
  insufficient_evidence: { label: "Not enough evidence", tone: "neutral" },
};

const LEVEL: Record<Understanding, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  strong: { label: "Strong", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  weak: { label: "Weak", tone: "danger" },
  not_demonstrated: { label: "Not shown", tone: "neutral" },
};

/** The AI's written assessment: verdict and summary, each project, each criterion, and next steps. */
export function AiReportView({ report: a }: { report: AiReport }) {
  const verdict = VERDICT[a.verdict] ?? VERDICT.insufficient_evidence;
  return (
    <div className="space-y-6">
      <div>
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        {a.summary && <p className="mt-3 text-sm leading-relaxed">{a.summary}</p>}
      </div>

      {a.projects.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.14em] text-subtle uppercase">Projects discussed</h3>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {a.projects.map((p) => (
              <li key={p.name} className="space-y-1.5 p-4 break-inside-avoid">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{p.name}</p>
                  <Badge tone={(LEVEL[p.understanding] ?? LEVEL.not_demonstrated).tone}>
                    {(LEVEL[p.understanding] ?? LEVEL.not_demonstrated).label}
                  </Badge>
                </div>
                {p.comment && <p className="text-sm text-muted">{p.comment}</p>}
                {p.evidence && <p className="border-l-2 border-accent/40 pl-3 text-sm italic">“{p.evidence}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.criteria.some((c) => c.score !== null || c.comment) && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.14em] text-subtle uppercase">By criterion (AI&apos;s view)</h3>
          <table className="mt-2 w-full text-sm">
            <tbody className="divide-y divide-border">
              {a.criteria.map((c) => (
                <tr key={c.name} className="align-top break-inside-avoid">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{c.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                    {c.score === null ? <span className="text-subtle">Not tested</span> : `${c.score}/10`}
                  </td>
                  <td className="py-2 text-muted">{c.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Points title="Strengths" items={a.strengths} tone="text-success" />
        <Points title="Gaps" items={a.gaps} tone="text-warning" />
      </div>
      <Points title="Claimed vs. shown" items={a.claimsVsShown} tone="text-danger" />
      <Points title="Next steps" items={a.nextSteps} tone="text-accent" />
    </div>
  );
}

function Points({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="break-inside-avoid">
      <h3 className={`text-xs font-semibold tracking-[0.14em] uppercase ${tone}`}>{title}</h3>
      <ul className="mt-2 space-y-1.5 text-sm">
        {items.map((x) => (
          <li key={x} className="flex gap-2">
            <span className={tone}>•</span>
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Overall mark and the per-criterion breakdown. */
export function MarksView({ marks }: { marks: ReleasedMarks }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="rounded-2xl bg-accent-soft px-6 py-4 text-center">
        <p className="text-xs text-muted">Overall</p>
        <p className="text-3xl font-semibold text-accent tabular-nums">
          {marks.score}
          <span className="text-base text-muted">/{marks.outOf}</span>
        </p>
      </div>
      {marks.criteria.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">Criterion</th>
              <th className="py-2 text-right font-medium">Weight</th>
              <th className="py-2 text-right font-medium">Marks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {marks.criteria.map((c) => (
              <tr key={c.name}>
                <td className="py-2">{c.name}</td>
                <td className="py-2 text-right text-muted tabular-nums">{c.weight ?? "–"}</td>
                <td className="py-2 text-right tabular-nums">{c.score === null ? "–" : `${c.score}/10`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Each question with the student's answer, word for word from the transcript. */
export function QAList({ qa }: { qa: { question: string; answer: string }[] }) {
  const items = qa.filter((p) => p.question || p.answer);
  if (!items.length) return <p className="text-sm text-muted">No questions were recorded.</p>;
  return (
    <ol className="space-y-5">
      {items.map((p, i) => (
        <li key={i} className="break-inside-avoid">
          <p className="text-sm font-medium">
            <span className="mr-2 text-accent">Q{i + 1}.</span>
            {p.question || <span className="text-subtle">(answer without a recorded question)</span>}
          </p>
          <p className="mt-1.5 border-l-2 border-border-strong pl-3 text-sm text-muted">
            {p.answer || <span className="italic">No answer was recorded.</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}
