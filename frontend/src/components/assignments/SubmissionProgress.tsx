import type { Assignment } from "@/types";
import { ProgressBar } from "@/components/ui/Display";

/** Bar + legend: turned in / not turned in. */
export function SubmissionProgress({ a }: { a: Assignment }) {
  return (
    <div className="space-y-2">
      <ProgressBar
        parts={[
          { value: a.submittedCount, className: "bg-success", label: "Turned in" },
          { value: a.missingCount, className: "bg-transparent", label: "Not turned in" },
        ]}
      />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-success" />
          {a.submittedCount} turned in
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-raised ring-1 ring-border-strong" />
          {a.missingCount} not turned in
        </span>
      </p>
    </div>
  );
}
