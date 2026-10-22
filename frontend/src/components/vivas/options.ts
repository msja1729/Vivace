import type { SummaryStat } from "@/types";

// Class-wide statistics the instructor can ask for in the summary report.
export const SUMMARY_STATS: { value: SummaryStat; label: string; description: string }[] = [
  { value: "average_score", label: "Average score", description: "Class mean and median of final scores." },
  { value: "score_distribution", label: "Score distribution", description: "How many students fall in each score band." },
  { value: "criteria_breakdown", label: "Per-criterion averages", description: "Class average for each evaluation criterion." },
  { value: "completion_rate", label: "Completion rate", description: "How many assigned students finished the viva." },
  { value: "common_strengths", label: "Common strengths", description: "Concepts most students explained well." },
  { value: "common_gaps", label: "Common gaps", description: "Concepts most students struggled with." },
  { value: "proctoring_flags", label: "Proctoring flags", description: "Flags by type, and who was flagged most." },
  { value: "top_and_bottom", label: "Top & bottom performers", description: "Highest and lowest scores, linked to reports." },
];

export const INSTRUCTIONS_EXAMPLE = `Start with the student's strongest project from their resume.
- Ask why they chose that design and what would break if a key part changed.
- Check each skill they claim on the resume with one concrete question.
- Use the Claude transcripts: ask what they changed in the AI's suggestions, and why.
- Keep questions short. Ask at most 2 follow-ups when an answer is shallow.
- About 8–10 questions in total. Don't give away answers.`;

export const REPORT_TEMPLATE = `For each student:
1. Overall score (out of 10) and a one-line verdict.
2. Score for each evaluation criterion, with a short quote from their answer as evidence.
3. Strengths.
4. Gaps: what they could not explain.
5. Resume / project claims vs. what they actually demonstrated.
6. Concrete next steps.
Write "insufficient evidence" when something wasn't tested enough. No inflated praise.`;
