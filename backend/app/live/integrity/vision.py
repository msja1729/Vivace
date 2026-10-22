"""Per-frame vision analysis. Runs in a worker thread (models are per thread, see engines.py)."""

import math
from dataclasses import dataclass, field

from app.live import engines
from app.live.config import live_config

# Face mesh points sent to the examiner's overlay (face outline, eyes, lips, irises).
_OVERLAY_SETS = (
    "FACE_LANDMARKS_FACE_OVAL",
    "FACE_LANDMARKS_LEFT_EYE",
    "FACE_LANDMARKS_RIGHT_EYE",
    "FACE_LANDMARKS_LIPS",
)
_overlay: tuple[list[int], list[tuple[int, int]]] | None = None


def overlay_layout() -> tuple[list[int], list[tuple[int, int]]]:
    """(landmark indices we send, segments as pairs of positions in that list)."""
    global _overlay
    if _overlay is None:
        try:
            from mediapipe.tasks.python.vision import FaceLandmarksConnections as C

            pairs = [(c.start, c.end) for name in _OVERLAY_SETS for c in getattr(C, name)]
        except Exception:  # noqa: BLE001 — overlay is cosmetic
            pairs = []
        indices = sorted({i for p in pairs for i in p} | {468, 473})  # + iris centres
        pos = {idx: n for n, idx in enumerate(indices)}
        _overlay = (indices, [(pos[a], pos[b]) for a, b in pairs])
    return _overlay


@dataclass
class FrameObs:
    faces: int = 0
    face_boxes: list[list[float]] = field(default_factory=list)  # [x, y, w, h], 0..1 of the image
    yaw: float | None = None  # degrees, head turned left/right
    pitch: float | None = None  # degrees, head up/down
    eye_x: float | None = None  # -1..1, eyes looking towards the student's right (-) / left (+)
    eye_y: float | None = None  # -1..1, down (-) / up (+)
    mouth_open: float | None = None  # 0..1 (jawOpen blendshape)
    mesh: list[list[float]] = field(default_factory=list)  # overlay points, 0..1
    eye_center: list[float] | None = None
    objects: list[dict] = field(default_factory=list)  # {label, conf, box}
    persons: int | None = None  # people YOLO sees (None = detector off)
    face_ok: bool = False  # face detector ran
    objects_ok: bool = False


def _blend(categories) -> dict[str, float]:
    return {c.category_name: c.score for c in categories}


def _head_pose(matrix) -> tuple[float, float]:
    r = matrix[:3, :3]
    pitch = math.degrees(math.atan2(r[2][1], r[2][2]))
    yaw = math.degrees(math.atan2(-r[2][0], math.hypot(r[2][1], r[2][2])))
    return yaw, pitch


def analyze(jpeg: bytes, run_objects: bool = True) -> FrameObs:
    import cv2
    import numpy as np

    obs = FrameObs()
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return obs
    h, w = img.shape[:2]

    landmarker = engines.face_landmarker()
    if landmarker is not None:
        import mediapipe as mp

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        obs.face_ok = True
        obs.faces = len(result.face_landmarks)
        for lms in result.face_landmarks:
            xs, ys = [p.x for p in lms], [p.y for p in lms]
            obs.face_boxes.append([min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)])
        if obs.faces:
            # The biggest face is the student.
            main = max(range(obs.faces), key=lambda i: obs.face_boxes[i][2] * obs.face_boxes[i][3])
            lms = result.face_landmarks[main]
            if result.facial_transformation_matrixes:
                obs.yaw, obs.pitch = _head_pose(np.asarray(result.facial_transformation_matrixes[main]))
            if result.face_blendshapes:
                b = _blend(result.face_blendshapes[main])
                obs.eye_x = (
                    b.get("eyeLookOutLeft", 0)
                    + b.get("eyeLookInRight", 0)
                    - b.get("eyeLookInLeft", 0)
                    - b.get("eyeLookOutRight", 0)
                ) / 2
                obs.eye_y = (
                    b.get("eyeLookUpLeft", 0)
                    + b.get("eyeLookUpRight", 0)
                    - b.get("eyeLookDownLeft", 0)
                    - b.get("eyeLookDownRight", 0)
                ) / 2
                obs.mouth_open = b.get("jawOpen", 0)
            indices, _ = overlay_layout()
            obs.mesh = [[round(lms[i].x, 4), round(lms[i].y, 4)] for i in indices if i < len(lms)]
            if len(lms) > 473:
                obs.eye_center = [(lms[468].x + lms[473].x) / 2, (lms[468].y + lms[473].y) / 2]

    model = engines.yolo() if run_objects else None
    if model is not None:
        cfg = live_config()
        wanted = set(cfg.integrity.objects) | {"person"}
        result = model.predict(img, imgsz=cfg.vision.yolo_imgsz, conf=cfg.vision.yolo_conf, verbose=False)[0]
        obs.objects_ok = True
        obs.persons = 0
        for box, cls, conf in zip(
            result.boxes.xyxy.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist(), strict=True
        ):
            label = result.names[int(cls)]
            if label not in wanted:
                continue
            x1, y1, x2, y2 = box
            obs.objects.append(
                {
                    "label": label,
                    "conf": round(conf, 2),
                    "box": [x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h],
                }
            )
            if label == "person":
                obs.persons += 1
    return obs
