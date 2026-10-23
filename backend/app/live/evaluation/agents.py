"""The agents. Each is one LLM call with its own system prompt over a shared exam state.

- Grader: scores one answer against the evidence and lists weak points.

The Co-Pilot (topics, suggested questions, topic grades) is in topics.py."""

from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from app.live.evaluation.context import Context
from app.live.evaluation.llm import LLM


@dataclass
class ExamState:
    """What every agent sees: the viva brief, the student's work, and the dialogue so far."""

    title: str
    instructions: str
    criteria: list[dict]  # [{name, description, weight}]
    context: Context
    transcript: list[tuple[str, str]] = field(default_factory=list)  # (speaker, text)
    weak_points: list[str] = field(default_factory=list)

    def system_brief(self) -> str:
        crit = "\n".join(
            f"- {c['name']} (weight {c['weight']}): {c.get('description', '')}" for c in self.criteria
        )
        return (
            f"Viva: {self.title}\n\n"
            f"Instructor's interview instructions:\n{self.instructions or '(none given)'}\n\n"
            f"Evaluation criteria:\n{crit or '(none given)'}\n\n"
            f"The student's submitted work (resume, projects, notes):\n{self.context.brief}"
        )

    def dialogue(self, last: int = 30) -> str:
        lines = [f"{'Examiner' if s == 'examiner' else 'Student'}: {t}" for s, t in self.transcript[-last:]]
        return "\n".join(lines) or "(The interview hasn't started yet.)"


def _evidence(state: ExamState, query: str) -> str:
    hits = state.context.search(query, k=4)
    return "\n\n".join(f"[{c.source}]\n{c.text}" for c in hits) or "(no matching course or submission text)"


# ---------- Grader ----------


class CriterionScore(BaseModel):
    name: str
    tested: bool
    score: float  # 0–10, ignored when not tested


class Grade(BaseModel):
    correctness: float = Field(description="0–1")
    depth: float = Field(description="0–1")
    memorization_flag: bool
    reasoning: str
    strengths: list[str]
    weak_points: list[str]
    reference_answer: str
    criteria: list[CriterionScore]


GRADE_SCHEMA = {
    "type": "object",
    "properties": {
        "correctness": {"type": "number", "description": "0 to 1: how correct the answer is"},
        "depth": {
            "type": "number",
            "description": "0 to 1: reasoning beyond definitions; why/how/trade-offs",
        },
        "memorization_flag": {
            "type": "boolean",
            "description": "true if it sounds recited (textbook phrasing, no own example, can't connect to their work)",
        },
        "reasoning": {"type": "string", "description": "two sentences at most, citing the answer"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weak_points": {
            "type": "array",
            "items": {"type": "string"},
            "description": "specific gaps worth probing",
        },
        "reference_answer": {
            "type": "string",
            "description": "what a strong answer would say, 2-4 sentences",
        },
        "criteria": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "tested": {"type": "boolean"},
                    "score": {"type": "number", "description": "0 to 10"},
                },
                "required": ["name", "tested", "score"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "correctness",
        "depth",
        "memorization_flag",
        "reasoning",
        "strengths",
        "weak_points",
        "reference_answer",
        "criteria",
    ],
    "additionalProperties": False,
}

GRADER_SYSTEM = """You are the Grader in an oral viva. You score ONE answer the student just gave.

Judge understanding, not polish: a hesitant but correct explanation in the student's own words beats a fluent \
definition. The transcript comes from speech recognition, so ignore filler words and small transcription errors. \
Set memorization_flag when the answer sounds recited: textbook wording, no concrete example, or no link to the \
student's own work when the question asked for one. Weak points must be specific enough that an examiner can \
turn each into a follow-up question. Score each evaluation criterion the answer gave evidence for; mark the \
others tested=false. Be fair and calibrated; do not inflate.

"""


async def grade(llm: LLM, state: ExamState, question: str, answer: str) -> Grade:
    prompt = (
        f"Question asked:\n{question or '(not captured)'}\n\n"
        f"Student's answer (speech-to-text):\n{answer}\n\n"
        f"Relevant passages from the student's work and the course:\n{_evidence(state, question + ' ' + answer)}\n\n"
        f"Dialogue so far, for context:\n{state.dialogue(16)}"
    )
    data = await llm.json(GRADER_SYSTEM + state.system_brief(), prompt, GRADE_SCHEMA)
    g = Grade.model_validate(data)
    g.correctness = max(0.0, min(1.0, g.correctness))
    g.depth = max(0.0, min(1.0, g.depth))
    for c in g.criteria:
        c.score = max(0.0, min(10.0, c.score))
    return g
