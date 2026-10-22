"""What the Grader and Co-Pilot know about this student and course (retrieval-augmented).

Sources: the viva's interview instructions and instruction files, the student's submission for the
linked assignment (resume, projects, notes, GitHub links), and the class material. Text is split into
chunks and embedded with MiniLM; `search()` returns the chunks closest to a question or answer.
For one student's documents a NumPy dot product is plenty fast, so no FAISS index is needed."""

import json
import logging
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import storage
from app.live import engines
from app.models import FileKind, StoredFile, Submission, Viva

log = logging.getLogger("live.context")

TEXT_EXT = {".txt", ".md", ".py", ".json", ".csv", ".html"}
CHUNK = 900
OVERLAP = 150
MAX_CHARS_PER_FILE = 60_000


def _read(path: Path) -> str:
    ext = path.suffix.lower()
    try:
        if ext == ".pdf":
            from pypdf import PdfReader

            return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
        if ext in (".docx", ".pptx"):
            # Both are zips of XML; the text sits in <w:t> / <a:t> tags.
            with zipfile.ZipFile(path) as z:
                xml = " ".join(
                    z.read(n).decode("utf-8", "ignore")
                    for n in z.namelist()
                    if n.startswith(("word/document", "ppt/slides/slide"))
                )
            return re.sub(r"\s+", " ", " ".join(re.findall(r"<[wa]:t[^>]*>([^<]*)</[wa]:t>", xml)))
        if ext == ".ipynb":
            cells = json.loads(path.read_text(encoding="utf-8")).get("cells", [])
            return "\n\n".join("".join(c.get("source", [])) for c in cells)
        if ext in TEXT_EXT:
            return path.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:  # noqa: BLE001 — one unreadable file shouldn't stop the session
        log.warning("Couldn't read %s: %s", path.name, exc)
    return ""


def _chunks(text: str) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text).strip()[:MAX_CHARS_PER_FILE]
    out, i = [], 0
    while i < len(text):
        out.append(text[i : i + CHUNK])
        i += CHUNK - OVERLAP
    return [c for c in out if len(c.strip()) > 40]


@dataclass
class Chunk:
    source: str  # e.g. "Resume.pdf (student submission)"
    text: str


class Context:
    def __init__(self, brief: str, chunks: list[Chunk]):
        self.brief = brief  # the student's own submission, shortened — always given to the Co-Pilot
        self.chunks = chunks
        self._vectors = None
        model = engines.embedder()
        if model is not None and chunks:
            self._vectors = model.encode([c.text for c in chunks], normalize_embeddings=True)

    def search(self, query: str, k: int = 4) -> list[Chunk]:
        if not self.chunks or not query.strip():
            return []
        if self._vectors is not None:
            q = engines.embedder().encode([query], normalize_embeddings=True)[0]
            order = (self._vectors @ q).argsort()[::-1][:k]
            return [self.chunks[i] for i in order]
        # No embeddings: rank by shared words.
        words = set(re.findall(r"[a-z]{4,}", query.lower()))
        scored = sorted(
            self.chunks, key=lambda c: -len(words & set(re.findall(r"[a-z]{4,}", c.text.lower())))
        )
        return scored[:k]


def similarity(a: str, b: str) -> float | None:
    """Cosine similarity of two texts' embeddings (0..1), or None without the embedding model."""
    model = engines.embedder()
    if model is None or not a.strip() or not b.strip():
        return None
    va, vb = model.encode([a, b], normalize_embeddings=True)
    return max(0.0, float(va @ vb))


def build(db: Session, viva: Viva, student_id: str) -> Context:
    """Collect and index the documents. Slow-ish (file parsing + embeddings): run in a thread."""
    chunks: list[Chunk] = []
    brief_parts: list[str] = []

    if viva.assignment_id:
        sub = db.scalar(
            select(Submission).where(
                Submission.assignment_id == viva.assignment_id, Submission.student_id == student_id
            )
        )
        if sub is not None:
            if sub.note:
                brief_parts.append(f"Student's note: {sub.note}")
            if sub.github_links:
                brief_parts.append("GitHub: " + ", ".join(sub.github_links))
            for f in sub.files:
                text = _read(storage.path_for(f.storage_key))
                if text:
                    brief_parts.append(f"--- {f.name} ---\n{text[:4000]}")
                    chunks += [Chunk(f"{f.name} (student submission)", c) for c in _chunks(text)]

    for f in viva.files:
        chunks += [
            Chunk(f"{f.name} (viva instructions)", c) for c in _chunks(_read(storage.path_for(f.storage_key)))
        ]
    material = db.scalars(
        select(StoredFile).where(StoredFile.class_id == viva.class_id, StoredFile.kind == FileKind.material)
    )
    for f in material:
        chunks += [
            Chunk(f"{f.name} (course material)", c) for c in _chunks(_read(storage.path_for(f.storage_key)))
        ]

    brief = "\n\n".join(brief_parts)[:12_000] or "(The student has no submission linked to this viva.)"
    return Context(brief, chunks)
