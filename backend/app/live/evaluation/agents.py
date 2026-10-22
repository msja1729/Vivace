"""The Socratic agents. Each is one LLM call with its own system prompt over a shared exam state.

- Examiner: opening questions, topic by topic, from the student's work and the instructions.
- Devil's Advocate: when an answer is shallow or textbook-like, a counter-scenario or a planted flaw.
- Grader: scores one answer against the evidence and lists weak points.

In a staff-run viva the Examiner and Devil's Advocate don't speak to the student: their questions are
suggestions in the examiner's Co-Pilot panel, and the human decides what to ask."""

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


# ---------- Examiner + Devil's Advocate (the Co-Pilot) ----------


class Suggestion(BaseModel):
    question: str
    kind: str  # opening | follow_up | devils_advocate
    why: str
    criterion: str


SUGGESTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "one short spoken question"},
                    "kind": {"type": "string", "enum": ["opening", "follow_up", "devils_advocate"]},
                    "why": {"type": "string", "description": "one line: what this tests"},
                    "criterion": {"type": "string", "description": "the evaluation criterion it targets"},
                },
                "required": ["question", "kind", "why", "criterion"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}

EXAMINER_SYSTEM = """You are the Examiner agent, assisting a human examiner who is running a live oral viva. \
You suggest the questions; the human chooses what to ask. Questions are spoken aloud, so keep each to one or two \
short sentences. Ground them in the student's own submitted work and the instructor's instructions. Never give \
away the answer inside the question. Follow the instructor's instructions over your own preferences.

"""

DEVIL_SYSTEM = """You are the Devil's Advocate agent in a live oral viva, assisting a human examiner. The student's \
last answer was shallow or sounded memorised. Suggest questions that test whether they really understand: a \
counter-scenario ("what if the data were ten times larger?"), a change to their own design and its consequences, \
or a confident statement with a planted flaw that the student should catch. Keep each question short and spoken. \
Never reveal that a flaw is planted.

"""


async def suggest(llm: LLM, state: ExamState, last_grade: Grade | None, count: int = 3) -> list[Suggestion]:
    """Opening questions before the first answer; follow-ups after. Devil's Advocate takes over
    when the last answer was shallow or recited."""
    shallow = last_grade is not None and (last_grade.memorization_flag or last_grade.depth < 0.5)
    if not state.transcript:
        system, ask = (
            EXAMINER_SYSTEM,
            (
                f"Suggest {count} opening questions (kind=opening) on different topics from the student's work, "
                "covering different evaluation criteria."
            ),
        )
        query = state.context.brief[:500]
    elif shallow:
        system, ask = (
            DEVIL_SYSTEM,
            (
                f"Suggest {count} questions: at least two of kind=devils_advocate, the rest follow_up. "
                f"Weak points in the last answer: {'; '.join(last_grade.weak_points) or 'shallow / recited'}."
            ),
        )
        query = state.transcript[-1][1]
    else:
        open_points = "; ".join(state.weak_points[-6:]) or "none recorded"
        system, ask = (
            EXAMINER_SYSTEM,
            (
                f"Suggest {count} next questions: follow_up on open weak points ({open_points}), or opening "
                "questions on a topic or criterion not yet covered. Don't repeat questions already asked."
            ),
        )
        query = " ".join(t for _, t in state.transcript[-4:])
    prompt = (
        f"{ask}\n\nDialogue so far:\n{state.dialogue()}\n\n"
        f"Relevant passages from the student's work and the course:\n{_evidence(state, query)}"
    )
    data = await llm.json(system + state.system_brief(), prompt, SUGGESTIONS_SCHEMA, max_tokens=3000)
    return [Suggestion.model_validate(s) for s in data.get("suggestions", [])][: count + 1]
