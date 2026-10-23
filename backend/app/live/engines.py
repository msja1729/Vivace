"""Loads the ML models the live viva needs, once, on first use.

Every loader is optional: if a package isn't installed (the `live` extra) or a model can't load,
that detector is switched off and `status()` says why. The rest of the session keeps working."""

import logging
import threading
import urllib.request
from pathlib import Path

from app.core.config import get_settings

log = logging.getLogger("live.engines")

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

_locks: dict[str, threading.Lock] = {}  # one per model, so a slow load doesn't block the others
_locks_guard = threading.Lock()
_local = threading.local()  # MediaPipe and YOLO objects aren't thread-safe: one per worker thread
_singletons: dict[str, object] = {}
_errors: dict[str, str] = {}
_ready: set[str] = set()


def device() -> str:
    wanted = get_settings().ml_device
    if wanted != "auto":
        return wanted
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def _download(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        log.info("Downloading %s", url)
        tmp = dest.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(dest)
    return dest


def _lock(name: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(name, threading.Lock())


def _guard(name: str, load):
    """Run a loader once per name; remember failures so we don't retry on every frame."""
    if name in _errors:
        return None
    try:
        model = load()
        _ready.add(name)
        return model
    except Exception as exc:  # noqa: BLE001 — any failure just disables this detector
        log.warning("%s unavailable: %s", name, exc)
        _errors[name] = f"{type(exc).__name__}: {exc}"
        return None


def _singleton(name: str, load):
    if name in _singletons:
        return _singletons[name]
    with _lock(name):
        if name not in _singletons and name not in _errors:
            model = _guard(name, load)
            if model is not None:
                _singletons[name] = model
    return _singletons.get(name)


# ---------- Vision (per thread) ----------


def face_landmarker():
    """MediaPipe Face Landmarker: 478 landmarks incl. irises, blendshapes, and head pose matrix."""
    if not hasattr(_local, "face"):

        def load():
            from mediapipe.tasks.python import BaseOptions, vision

            path = _download(FACE_MODEL_URL, MODELS_DIR / "face_landmarker.task")
            options = vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(path)),
                running_mode=vision.RunningMode.IMAGE,
                num_faces=3,
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
            )
            return vision.FaceLandmarker.create_from_options(options)

        with _lock("face"):
            _local.face = _guard("face", load)
    return _local.face


def yolo():
    """YOLOv8n for phones, laptops, screens, books and extra people."""
    if not hasattr(_local, "yolo"):

        def load():
            from ultralytics import YOLO

            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            model = YOLO(str(MODELS_DIR / "yolov8n.pt"))
            model.to(device())
            return model

        with _lock("objects"):
            _local.yolo = _guard("objects", load)
    return _local.yolo


# ---------- Audio (shared) ----------


def vad():
    def load():
        import webrtcvad

        return webrtcvad  # a Vad() is cheap; each stream makes its own

    return _singleton("vad", load)


def whisper():
    """faster-whisper speech-to-text. Falls back to CPU if CUDA libraries are missing."""

    def load():
        from faster_whisper import WhisperModel

        size = get_settings().whisper_model
        if device() == "cuda":
            try:
                return WhisperModel(size, device="cuda", compute_type="float16")
            except Exception as exc:  # noqa: BLE001
                log.warning("Whisper on CUDA failed (%s); using CPU", exc)
        return WhisperModel(size, device="cpu", compute_type="int8")

    return _singleton("stt", load)


def speaker_encoder():
    """SpeechBrain ECAPA-TDNN speaker embeddings (for the voice print check)."""

    def load():
        from speechbrain.inference.speaker import EncoderClassifier
        from speechbrain.utils.fetching import LocalStrategy

        return EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=str(MODELS_DIR / "spkrec-ecapa-voxceleb"),
            run_opts={"device": device()},
            local_strategy=LocalStrategy.COPY,  # symlinks need admin rights on Windows
        )

    return _singleton("speaker", load)


def embedder():
    """Sentence embeddings for answer-vs-reference similarity and retrieving course context."""

    def load():
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer("all-MiniLM-L6-v2", device=device())

    return _singleton("embeddings", load)


def warm_vision() -> None:
    """Load the per-thread vision models (call it on each vision worker thread)."""
    face_landmarker()
    yolo()


ENGINE_LABELS = {
    "face": "Face, gaze & head pose (MediaPipe)",
    "objects": "Objects & extra people (YOLOv8n)",
    "vad": "Voice activity (WebRTC VAD)",
    "stt": "Speech to text (Deepgram Nova-3, local Whisper backup)"
    if get_settings().stt_provider == "deepgram"
    else "Speech to text (faster-whisper)",
    "speaker": "Voice print (SpeechBrain ECAPA)",
    "embeddings": "Answer similarity (MiniLM)",
}


def status() -> dict[str, dict]:
    return {
        name: {
            "label": label,
            "state": "error" if name in _errors else "ready" if name in _ready else "not_loaded",
            "detail": _errors.get(name, ""),
        }
        for name, label in ENGINE_LABELS.items()
    }
