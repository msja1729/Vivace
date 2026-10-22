"""The AI's written report for one viva, made when the interview ends (and on request).

The report is for people who weren't in the room: plain language, evidence from the transcript,
and an honest verdict. Questions and answers are paired straight from the transcript (no AI)."""

import asyncio
import logging
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.live.evaluation import context as ctx
from app.live.evaluation.llm import LLM, LLMError
from app.models import Speaker, Viva, VivaSession

log = logging.getLogger("live.report")

LEVELS = ["strong", "partial", "weak", "not_demonstrated"]
VERDICTS = ["strong", "good", "partial", "weak", "insufficient_evidence"]

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": VERDICTS, "description": "overall understanding"},
        "summary": {"type": "string", "description": "3-5 plain sentences anyone can follow"},
        "projects": {
            "type": "array",
            "description": "each project or topic the viva covered",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "understanding": {"type": "string", "enum": LEVELS},
                    "comment": {"type": "string", "description": "one or two sentences"},
                    "evidence": {"type": "string", "description": "a short quote from the student's answers"},
                },
                "required": ["name", "understanding", "comment", "evidence"],
                "additionalProperties": False,
            },
        },
        "criteria": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "score": {"type": "number", "description": "0-10, or -1 if not tested"},
                    "comment": {"type": "string"},
                },
                "required": ["name", "score", "comment"],
                "additionalProperties": False,
            },
        },
        "strengths": {"type": "array", "items": {"type": "string"}},
        "gaps": {"type": "array", "items": {"type": "string"}},
        "claims_vs_shown": {
            "type": "array",
            "items": {"type": "string"},
            "description": "where the resume / project claims and what the student could explain differ",
        },
        "next_steps": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "verdict",
        "summary",
        "projects",
        "criteria",
        "strengths",
        "gaps",
        "claims_vs_shown",
        "next_steps",
    ],
    "additionalProperties": False,
}

REPORT_SYSTEM = """You write the final report of an oral viva (an interview that tests whether a student \
really understands their own projects and the course). Your reader may not have been in the room: a \
student, a parent or another teacher. Write plainly, without jargon or scoring formulas.

Be honest. Judge only what the transcript shows: say so plainly when understanding was weak, never inflate \
praise, and use "not_demonstrated" / "insufficient_evidence" when something wasn't tested enough instead of \
guessing. Back every judgement with what the student actually said. Speech-to-text may garble a few words: \
read past obvious transcription errors. Follow the instructor's report format where it asks for something. Leave a list empty rather than filling it with a placeholder (e.g. claims_vs_shown when there was no submitted work to compare with).
"""


def qa_pairs(turns) -> list[dict]:
    """[{question, answer}] in order: consecutive examiner turns form a question, the student's turns after
    it are the answer. Small talk before the first question is kept as a question without an answer text."""
    pairs: list[dict] = []
    for t in turns:
        text = t.text.strip()
        if not text:
            continue
        if t.speaker == Speaker.examiner:
            if pairs and not pairs[-1]["answer"]:
                pairs[-1]["question"] = f"{pairs[-1]['question']} {text}".strip()
            else:
                pairs.append({"question": text, "answer": ""})
        else:
            if not pairs:
                pairs.append({"question": "", "answer": ""})
            pairs[-1]["answer"] = f"{pairs[-1]['answer']} {text}".strip()
    return pairs


def _prompt(viva: Viva, work: str, pairs: list[dict]) -> str:
    crit = "\n".join(
        f"- {c['name']} (weight {c['weight']}): {c.get('description', '')}" for c in viva.evaluation_criteria
    )
    qa = "\n\n".join(
        f"Q{i}. {p['question'] or '(no question)'}\nA{i}. {p['answer'] or '(no answer)'}"
        for i, p in enumerate(pairs, 1)
    )
    return (
        f"Viva: {viva.title}\n\n"
        f"Instructor's interview instructions:\n{viva.interview_instructions or '(none)'}\n\n"
        f"Evaluation criteria (score each 0-10, or -1 if not tested):\n{crit or '(none)'}\n\n"
        f"Instructor's report format:\n{viva.report_format or '(none: use your own clear structure)'}\n\n"
        f"The student's submitted work (resume, projects, notes):\n{work[:12000]}\n\n"
        f"The interview, question by question:\n{qa or '(nothing was said)'}\n\nWrite the report."
    )


async def generate(session_id: str, db_factory: Callable[[], Session], llm: LLM) -> dict:
    """Writes and saves the AI report for a finished session. Raises LLMError if the AI fails."""

    def load():
        with db_factory() as db:
            s = db.get(VivaSession, session_id)
            viva = db.get(Viva, s.viva_id)
            work = ctx.build(db, viva, s.student_id).brief
            return viva, work, qa_pairs(s.turns)

    viva, work, pairs = await asyncio.get_running_loop().run_in_executor(None, load)
    if not any(p["answer"] for p in pairs):
        raise LLMError(
            "The student didn't answer anything that was transcribed, so there is nothing to assess."
        )
    data = await llm.json(REPORT_SYSTEM, _prompt(viva, work, pairs), REPORT_SCHEMA, max_tokens=6000)
    report = _clean(data, [c["name"] for c in viva.evaluation_criteria])
    with db_factory() as db:
        s = db.get(VivaSession, session_id)
        s.ai_report = report
        db.commit()
    return report


def _clean(data: dict, criteria: list[str]) -> dict:
    """Keeps the report to the expected shape, whatever the model returned."""

    def strings(key: str) -> list[str]:
        return [str(x).strip() for x in data.get(key) or [] if str(x).strip()][:8]

    def score(v) -> float | None:
        try:
            return None if v is None or float(v) < 0 else round(min(10.0, float(v)), 1)
        except (TypeError, ValueError):
            return None

    by_name = {str(c.get("name", "")).lower(): c for c in data.get("criteria") or [] if isinstance(c, dict)}
    return {
        "verdict": data.get("verdict") if data.get("verdict") in VERDICTS else "insufficient_evidence",
        "summary": str(data.get("summary", "")).strip(),
        "projects": [
            {
                "name": str(p.get("name", "")).strip() or "Project",
                "understanding": p.get("understanding")
                if p.get("understanding") in LEVELS
                else "not_demonstrated",
                "comment": str(p.get("comment", "")).strip(),
                "evidence": str(p.get("evidence", "")).strip(),
            }
            for p in (data.get("projects") or [])[:10]
            if isinstance(p, dict)
        ],
        "criteria": [
            {
                "name": name,
                "score": score(by_name.get(name.lower(), {}).get("score")),
                "comment": str(by_name.get(name.lower(), {}).get("comment", "")).strip(),
            }
            for name in criteria
        ],
        "strengths": strings("strengths"),
        "gaps": strings("gaps"),
        "claimsVsShown": strings("claims_vs_shown"),
        "nextSteps": strings("next_steps"),
    }
