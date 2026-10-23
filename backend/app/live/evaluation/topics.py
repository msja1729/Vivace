"""The Co-Pilot, topic by topic: what in the student's work can be tested, questions on the topic the
examiner picks (opening, follow-up on the last answer, or a different part of it), and a running
judgement of whether there is enough evidence to grade the topic.

The examiner leads: they pick the topic and the kind of question, and may always ask their own. Every
question and answer on the current topic is kept, and read again before each suggestion or judgement."""

from app.live.evaluation.agents import ExamState, _evidence
from app.live.evaluation.llm import LLM

KINDS = ["project", "experience", "skill", "claim", "course"]
LEVELS = ["strong", "partial", "weak", "not_demonstrated"]
MODES = ["opening", "follow_up", "different"]

TOPICS_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "short name, e.g. the project title"},
                    "kind": {"type": "string", "enum": KINDS},
                    "summary": {"type": "string", "description": "one line: what there is to test"},
                },
                "required": ["name", "kind", "summary"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["topics"],
    "additionalProperties": False,
}

QUESTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "one short spoken question"},
                    "why": {"type": "string", "description": "one line: what it tests"},
                    "criterion": {"type": "string", "description": "the evaluation criterion it targets"},
                },
                "required": ["question", "why", "criterion"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["questions"],
    "additionalProperties": False,
}

ASSESS_SCHEMA = {
    "type": "object",
    "properties": {
        "ready": {"type": "boolean", "description": "enough evidence to be confident about the grade"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "level": {"type": "string", "enum": LEVELS},
        "score": {"type": "number", "description": "0-10"},
        "summary": {"type": "string", "description": "one or two plain sentences"},
        "evidence": {"type": "string", "description": "a short quote from the student's answers"},
        "missing": {"type": "string", "description": "what is still untested, if anything"},
    },
    "required": ["ready", "confidence", "level", "score", "summary", "evidence", "missing"],
    "additionalProperties": False,
}

TOPICS_SYSTEM = """You prepare an oral viva. From the student's submitted work (resume, projects, notes) \
list what the examiner can test them on: each project, then work experience, notable skills, and specific \
claims worth checking. Use the names the student uses. At most 10 topics, most important first.

"""

QUESTIONS_SYSTEM = """You assist a human examiner in a live oral viva. You suggest questions; the examiner \
decides what to ask, and often asks their own. Questions are spoken: one or two short sentences each, \
never giving the answer away, grounded in the student's own work on the given topic.

"""

ASSESS_SYSTEM = """You judge, from the questions and answers on ONE topic of an oral viva, how well the \
student really understands it. Judge only what the answers show; speech-to-text may garble a few words. \
Be honest: don't inflate. Recited definitions without explanation are weak evidence.

"""

MODE_ASK = {
    "opening": "Suggest 3 opening questions on this topic, each on a different aspect (design, how a key "
    "part works, results, choices made).",
    "follow_up": "Suggest 3 follow-up questions on the student's LAST answer, to test whether they truly "
    "understand what they just said: ask why or how, for a consequence or an edge case, to explain a term "
    "they used, or to justify a choice. Stay on what they said.",
    "different": "Suggest 3 questions on a DIFFERENT part of the same topic that hasn't been asked about "
    "yet. Don't repeat earlier questions.",
}


def _log_text(log: list[dict]) -> str:
    return (
        "\n\n".join(
            f"Q{i}. {x['q'] or '(no question)'}\nA{i}. {x['a'] or '(no answer)'}"
            for i, x in enumerate(log, 1)
        )
        or "(Nothing asked on this topic yet.)"
    )


def _topic_text(topic: dict) -> str:
    return f"Topic: {topic['name']} ({topic['kind']}). {topic['summary']}"


async def find_topics(llm: LLM, state: ExamState) -> list[dict]:
    """[{id, name, kind, summary}] from the student's work."""
    prompt = f"The student's submitted work:\n{state.context.brief[:14000]}\n\nList the topics."
    data = await llm.json(TOPICS_SYSTEM + state.system_brief(), prompt, TOPICS_SCHEMA, max_tokens=2000)
    topics = []
    for i, t in enumerate((data.get("topics") or [])[:10], 1):
        if isinstance(t, dict) and str(t.get("name", "")).strip():
            kind = t.get("kind") if t.get("kind") in KINDS else "project"
            topics.append(
                {
                    "id": f"t{i}",
                    "name": str(t["name"]).strip()[:80],
                    "kind": kind,
                    "summary": str(t.get("summary", ""))[:300],
                }
            )
    return topics


async def questions(llm: LLM, state: ExamState, topic: dict, log: list[dict], mode: str) -> list[dict]:
    """A few questions on the topic: opening ones, follow-ups on the last answer, or a different part."""
    if mode == "follow_up" and not log:
        mode = "opening"
    query = " ".join([topic["name"], topic["summary"], *(x["a"] for x in log[-2:])])
    prompt = (
        f"{_topic_text(topic)}\n\n{MODE_ASK[mode]}\n\n"
        f"Questions and answers on this topic so far:\n{_log_text(log)}\n\n"
        f"Relevant passages from the student's work and the course:\n{_evidence(state, query)}"
    )
    data = await llm.json(QUESTIONS_SYSTEM + state.system_brief(), prompt, QUESTIONS_SCHEMA, max_tokens=2000)
    out = []
    for q in (data.get("questions") or [])[:4]:
        if isinstance(q, dict) and str(q.get("question", "")).strip():
            out.append(
                {
                    "question": str(q["question"]).strip(),
                    "why": str(q.get("why", "")),
                    "criterion": str(q.get("criterion", "")),
                    "kind": mode,
                }
            )
    return out


async def assess(llm: LLM, state: ExamState, topic: dict, log: list[dict], final: bool) -> dict:
    """The judgement on the topic. `final`: grade now with whatever evidence there is."""
    ask = (
        "Grade this topic now with the evidence available (the examiner has moved on). Set confidence "
        "honestly: low if little was asked."
        if final
        else "Is there enough evidence to grade this topic with confidence? ready=true only if the answers "
        "clearly show strong, partial or weak understanding across more than one aspect (or the student "
        "clearly couldn't answer). Otherwise ready=false and say what is still missing."
    )
    prompt = f"{_topic_text(topic)}\n\n{ask}\n\nQuestions and answers on this topic:\n{_log_text(log)}"
    data = await llm.json(ASSESS_SYSTEM + state.system_brief(), prompt, ASSESS_SCHEMA, max_tokens=1500)
    try:
        score = round(max(0.0, min(10.0, float(data.get("score", 0)))), 1)
    except (TypeError, ValueError):
        score = 0.0
    return {
        "ready": bool(data.get("ready")) or final,
        "confidence": data.get("confidence")
        if data.get("confidence") in ("high", "medium", "low")
        else "low",
        "level": data.get("level") if data.get("level") in LEVELS else "not_demonstrated",
        "score": score,
        "summary": str(data.get("summary", "")).strip(),
        "evidence": str(data.get("evidence", "")).strip(),
        "missing": str(data.get("missing", "")).strip(),
        "answers": len(log),
    }
