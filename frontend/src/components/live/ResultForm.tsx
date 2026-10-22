"use client";

import { useMemo, useState } from "react";
import type { Criterion, SessionReport } from "@/types";
import { saveSessionResult } from "@/lib/api/vivas";
import { Button } from "@/components/ui/Button";
import { FormError, TextAreaField, inputClass } from "@/components/ui/Field";

/**
 * The examiner's marks: a score per evaluation criterion (pre-filled with the AI's suggestions),
 * the overall mark out of 10 (the weighted average is offered), and notes.
 */
export function ResultForm({
  report,
  criteria: list,
  onSaved,
}: {
  report: SessionReport;
  criteria: Criterion[];
  onSaved?: (r: SessionReport) => void;
}) {
  const [score, setScore] = useState(report.score !== null ? String(report.score) : "");
  const [criteria, setCriteria] = useState<Record<string, string>>(() => {
    const given = new Map(report.criteriaScores.map((c) => [c.name, c.score]));
    const suggested = new Map(report.suggestedCriteriaScores.map((c) => [c.name, c.score]));
    const ai = new Map((report.aiReport?.criteria ?? []).map((c) => [c.name, c.score]));
    return Object.fromEntries(
      list.map((c) => [c.name, String(given.get(c.name) ?? ai.get(c.name) ?? suggested.get(c.name) ?? "")]),
    );
  });
  const [notes, setNotes] = useState(report.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(report.score !== null);

  // Weighted average of the criterion scores, as a starting point for the overall mark.
  const weighted = useMemo(() => {
    let total = 0;
    let weight = 0;
    for (const c of list) {
      const v = Number(criteria[c.name]);
      if (criteria[c.name] !== "" && !Number.isNaN(v)) {
        total += v * c.weight;
        weight += c.weight;
      }
    }
    return weight ? Math.round((total / weight) * 10) / 10 : null;
  }, [criteria, list]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await saveSessionResult(report.id, {
        score: Number(score),
        criteriaScores: list.map((c) => ({
          name: c.name,
          score: criteria[c.name] === "" || criteria[c.name] === undefined ? null : Number(criteria[c.name]),
        })),
        notes,
      });
      setSaved(true);
      onSaved?.(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-3">
          {list.map((c) => (
            <label key={c.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                {c.name} <span className="text-xs whitespace-nowrap text-subtle">· weight {c.weight}</span>
              </span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={criteria[c.name] ?? ""}
                onChange={(e) => setCriteria((x) => ({ ...x, [c.name]: e.target.value }))}
                className={`${inputClass} !w-20 shrink-0`}
                aria-label={`${c.name} score out of 10`}
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm font-semibold">
            Overall (out of 10)
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={score}
              placeholder={weighted !== null ? String(weighted) : ""}
              onChange={(e) => setScore(e.target.value)}
              className={`${inputClass} !w-20 shrink-0`}
            />
          </label>
          {weighted !== null && score === "" && (
            <button type="button" className="text-xs text-accent" onClick={() => setScore(String(weighted))}>
              Use weighted average ({weighted})
            </button>
          )}
        </div>
        <TextAreaField
          label="Notes (for your report; not sent to the student unless you write them in the message)"
          name="notes"
          rows={6}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="accent" disabled={busy || score === ""} onClick={save}>
          {busy ? "Saving…" : saved ? "Update marks" : "Save marks"}
        </Button>
        {saved && !busy && <span className="text-sm text-success">Saved</span>}
        <FormError message={error} />
      </div>
    </div>
  );
}
