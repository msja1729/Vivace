import type { VivaPhase } from "@/types";
import { Badge } from "@/components/ui/Display";

const LABELS: Record<VivaPhase, { label: string; tone: "neutral" | "accent" | "success" | "warning" }> = {
  draft: { label: "Draft", tone: "neutral" },
  upcoming: { label: "Scheduled", tone: "accent" },
  live: { label: "Live", tone: "success" },
  closed: { label: "Finished", tone: "neutral" },
};

export function PhaseBadge({ phase }: { phase: VivaPhase }) {
  const { label, tone } = LABELS[phase];
  return <Badge tone={tone}>{label}</Badge>;
}
