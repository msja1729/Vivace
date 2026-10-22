"""The agents. Each is one LLM call with its own system prompt over a shared exam state.

- Grader: scores one answer against the evidence and lists weak points.
- Co-Pilot: suggests the examiner's next questions, one project at a time: follow-ups on the topic the
  examiner just asked about, probing questions when an answer is shallow, and, once there is enough
  evidence on a project, the move to the next one (with cross-project questions later on).

The human examiner decides what to ask; the Co-Pilot's questions are only suggestions."""

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


# ---------- The Co-Pilot: suggested questions, one project at a time ----------


KINDS = ["opening", "follow_up", "deeper", "devils_advocate", "cross_project", "new_project"]


class Suggestion(BaseModel):
    question: str
    kind: str  # one of KINDS
    why: str
    criterion: str


class Plan(BaseModel):
    """Where the interview stands, project by project, plus the next questions to ask."""

    projects: list[str]  # the student's projects / main topics, from their submitted work
    current_project: str  # the project the conversation is on now
    enough_evidence: bool  # enough answers to judge the student on current_project
    coverage_note: str  # one line: what has been established, or what is still missing
    next_project: str  # when enough_evidence: the project to move to ("" if none left)
    suggestions: list[Suggestion]


PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "projects": {"type": "array", "items": {"type": "string"}, "description": "short project names"},
        "current_project": {"type": "string"},
        "enough_evidence": {"type": "boolean"},
        "coverage_note": {"type": "string", "description": "one short line"},
        "next_project": {"type": "string"},
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "one short spoken question"},
                    "kind": {"type": "string", "enum": KINDS},
                    "why": {"type": "string", "description": "one line: what this tests"},
                    "criterion": {"type": "string", "description": "the evaluation criterion it targets"},
                },
                "required": ["question", "kind", "why", "criterion"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "projects",
        "current_project",
        "enough_evidence",
        "coverage_note",
        "next_project",
        "suggestions",
    ],
    "additionalProperties": False,
}

COPILOT_SYSTEM = """You are the Co-Pilot of a human examiner running a live oral viva about the student's own projects. You suggest the next questions; the examiner decides what to ask (often their own question). Questions are spoken aloud: one or two short sentences each, and never give the answer away.

How the interview flows, one project at a time:
1. Follow the examiner. Stay on the topic of the examiner's most recent question and the student's answer to it: dig into what the student just said (kind=follow_up), or into another part of the SAME project (kind=deeper): design choices and why, alternatives, how a key part works, failure cases, testing, results.
2. If the last answer was shallow, vague or sounded memorised, include a probing question (kind=devils_advocate): a counter-scenario, a change to their design, or a statement with a subtle flaw for them to catch (never say so).
3. After each answer, decide whether you now have enough evidence to judge how well the student understands the current project (usually 4-6 substantive answers that covered design, implementation and trade-offs; fewer if the answers clearly show strong or clearly weak understanding). If so: enough_evidence=true, say why in coverage_note, set next_project to a project not covered yet, and make the suggestions opening questions on next_project (kind=new_project).
4. Once at least one project has been covered, you may add one question that connects concepts across projects (kind=cross_project), e.g. comparing two design decisions or reusing an idea from one project in another.
5. Before the first question, suggest opening questions on the student's main project (kind=opening).
Follow the instructor's instructions over your own preferences.

"""


async def suggest(
    llm: LLM,
    state: ExamState,
    last_grade: Grade | None,
    covered: list[str],
    focus: str = "",
    count: int = 3,
) -> Plan:
    """The next questions, staying on the current project until there is enough evidence to grade it."""
    shallow = last_grade is not None and (last_grade.memorization_flag or last_grade.depth < 0.5)
    notes = [f"Projects already covered (enough evidence): {', '.join(covered) or 'none yet'}."]
    if focus:
        notes.append(f"The examiner chose to move to this project now: {focus}. Suggest questions about it.")
    if last_grade is not None:
        quality = "shallow or memorised" if shallow else "substantive"
        weak = "; ".join(last_grade.weak_points) or "none"
        notes.append(f"The last answer was {quality}. Its weak points: {weak}.")
    if not state.transcript:
        notes.append("The interview hasn't started: suggest opening questions.")
    query = " ".join(t for _, t in state.transcript[-4:]) or state.context.brief[:500]
    prompt = (
        f"Suggest {count} questions.\n" + "\n".join(notes) + f"\n\nDialogue so far:\n{state.dialogue()}\n\n"
        f"Relevant passages from the student's work and the course:\n{_evidence(state, query)}"
    )
    data = await llm.json(COPILOT_SYSTEM + state.system_brief(), prompt, PLAN_SCHEMA, max_tokens=3000)
    items = [Suggestion.model_validate(x) for x in data.get("suggestions", [])][: count + 1]
    for item in items:
        if item.kind not in KINDS:
            item.kind = "follow_up"
    return Plan(
        projects=[str(x) for x in data.get("projects", [])][:12],
        current_project=str(data.get("current_project", "")),
        enough_evidence=bool(data.get("enough_evidence", False)),
        coverage_note=str(data.get("coverage_note", "")),
        next_project=str(data.get("next_project", "")),
        suggestions=items,
    )
