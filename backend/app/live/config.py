"""Engine thresholds and weights, from config.yaml (see that file for what each one means)."""

from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

from app.core.config import get_settings


class VisionConfig(BaseModel):
    fps: int = 5
    yolo_imgsz: int = 480
    yolo_conf: float = 0.45


class IntegrityConfig(BaseModel):
    gaze_off_seconds: float = 3
    gaze_up_seconds: float = 10  # looking up (thinking) needs longer
    head_yaw_deg: float = 30
    head_pitch_deg: float = 20
    head_turn_seconds: float = 3
    reading_sweeps: int = 3  # lines read (slow across, quick back) within the window
    reading_window_seconds: float = 12
    no_face_seconds: float = 3
    object_frames: int = 3
    # A second person counts only above this detector confidence. The student's own shadow on the
    # wall scores ~0.45-0.6; the student ~0.9, and a real person in view well above 0.65.
    person_conf: float = 0.65
    objects: list[str] = ["cell phone", "laptop", "book"]
    speaker_similarity: float = 0.25
    lipsync_seconds: float = 4


class MasteryWeights(BaseModel):
    correctness: float = 0.5
    similarity: float = 0.3
    fluency: float = 0.2


class LiveConfig(BaseModel):
    vision: VisionConfig = VisionConfig()
    integrity: IntegrityConfig = IntegrityConfig()
    risk_weights: dict[str, float] = {
        "gaze_off_screen": 6,
        "head_turned": 5,
        "reading_pattern": 10,
        "no_face": 8,
        "multiple_faces": 20,
        "prohibited_object": 20,
        "second_person": 25,
        "secondary_speaker": 20,
        "lipsync_mismatch": 12,
        "tab_switch": 15,
        "left_fullscreen": 8,
    }
    risk_window_seconds: float = 600
    mastery_weights: MasteryWeights = MasteryWeights()


@lru_cache
def live_config() -> LiveConfig:
    path = Path(get_settings().live_config_file)
    try:
        import yaml  # installed with the `live` extra
    except ImportError:
        return LiveConfig()
    if not path.exists():
        return LiveConfig()
    return LiveConfig.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
