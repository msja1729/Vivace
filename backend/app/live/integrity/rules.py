"""Turns per-frame observations into integrity flags with start/end times, and keeps the risk score.

Pure Python (no models), so the rules can be tested with made-up observations."""

import statistics
from collections import deque
from dataclasses import dataclass, field

from app.live.config import LiveConfig
from app.live.integrity.vision import FrameObs

LABELS = {
    "gaze_off_screen": "Looking away from the screen",
    "head_turned": "Head turned away",
    "reading_pattern": "Left-right reading pattern",
    "no_face": "No face in view",
    "multiple_faces": "More than one face",
    "prohibited_object": "Prohibited object",
    "second_person": "Another person in view",
    "secondary_speaker": "Another voice speaking",
    "lipsync_mismatch": "Speech while lips still",
}

# Default gaze bounds before calibration (blendshape units, roughly -1..1).
DEFAULT_BOUNDS = {"eye_x": [-0.45, 0.45], "eye_y": [-0.5, 0.45], "yaw": 0.0, "pitch": 0.0}


@dataclass
class Flag:
    type: str
    start: float
    end: float
    confidence: float = 1.0
    detail: str = ""
    closed: bool = False
    id: int | None = None  # database row, once saved
    snapshot_key: str | None = None


@dataclass
class Change:
    kind: str  # "open" | "close"
    flag: Flag


class _Condition:
    """A flag that opens once `active` has held for `min_s` seconds, and closes when it stops."""

    def __init__(self, type_: str, min_s: float):
        self.type, self.min_s = type_, min_s
        self.since: float | None = None
        self.flag: Flag | None = None

    def update(self, t: float, active: bool, detail: str = "", conf: float = 1.0) -> list[Change]:
        if active:
            if self.since is None:
                self.since = t
            if self.flag is None and t - self.since >= self.min_s:
                self.flag = Flag(self.type, self.since, t, round(conf, 2), detail)
                return [Change("open", self.flag)]
            if self.flag is not None:
                self.flag.end = t
                self.flag.confidence = max(self.flag.confidence, round(conf, 2))
            return []
        self.since = None
        if self.flag is not None:
            flag, self.flag = self.flag, None
            flag.end, flag.closed = max(flag.end, t), True
            return [Change("close", flag)]
        return []


@dataclass
class Calibration:
    """Gaze bounds from the 4-corner step: eye ranges, plus where the head points when facing the screen."""

    samples: list[tuple[float, float, float, float]] = field(default_factory=list)

    def bounds(self) -> dict:
        if len(self.samples) < 8:
            return dict(DEFAULT_BOUNDS)
        ex, ey, yaw, pitch = zip(*self.samples, strict=True)

        def widen(values, margin):
            lo, hi = min(values), max(values)
            pad = (hi - lo) * 0.25 + margin
            return [round(lo - pad, 3), round(hi + pad, 3)]

        return {
            "eye_x": widen(ex, 0.12),
            "eye_y": widen(ey, 0.12),
            "yaw": round(statistics.median(yaw), 1),
            "pitch": round(statistics.median(pitch), 1),
        }


class IntegrityMonitor:
    def __init__(self, cfg: LiveConfig, bounds: dict | None = None):
        self.cfg = cfg
        i = cfg.integrity
        self.bounds = bounds or dict(DEFAULT_BOUNDS)
        self.flags: list[Flag] = []
        self.peak_risk = 0.0
        self.calibration: Calibration | None = None

        self._gaze = _Condition("gaze_off_screen", i.gaze_off_seconds)
        self._head = _Condition("head_turned", i.head_turn_seconds)
        self._no_face = _Condition("no_face", i.no_face_seconds)
        self._faces = _Condition("multiple_faces", 0.3)  # 2 frames in a row, not a one-frame glitch
        self._reading = _Condition("reading_pattern", 0)
        self._lipsync = _Condition("lipsync_mismatch", i.lipsync_seconds)
        self._person = _Condition("second_person", 0)
        self._objects = {label: _Condition("prohibited_object", 0) for label in i.objects}

        self._recent_objects: deque[set[str]] = deque(maxlen=5)
        self._recent_persons: deque[int] = deque(maxlen=5)
        self._eyes: deque[tuple[float, float]] = deque()  # (t, eye_x)
        self._mouth: deque[tuple[float, float]] = deque()  # (t, mouth_open)
        self._voice: deque[tuple[float, bool]] = deque()  # (t, student speaking)

    # ---------- calibration ----------

    def start_calibration(self) -> None:
        self.calibration = Calibration()

    def finish_calibration(self) -> dict:
        if self.calibration is not None:
            self.bounds = self.calibration.bounds()
        self.calibration = None
        return self.bounds

    # ---------- inputs ----------

    def on_voice(self, t: float, speaking: bool) -> None:
        """Student voice activity (one call per audio chunk), used by the lip-sync check."""
        self._voice.append((t, speaking))
        while self._voice and self._voice[0][0] < t - 10:
            self._voice.popleft()

    def on_frame(self, t: float, obs: FrameObs) -> list[Change]:
        i = self.cfg.integrity
        if self.calibration is not None:
            if obs.faces == 1 and obs.eye_x is not None and obs.yaw is not None:
                self.calibration.samples.append((obs.eye_x, obs.eye_y, obs.yaw, obs.pitch))
            return []

        changes: list[Change] = []
        if obs.face_ok:
            one = obs.faces == 1
            changes += self._no_face.update(t, obs.faces == 0)
            changes += self._faces.update(t, obs.faces > 1, f"{obs.faces} faces")

            off = False
            if one and obs.eye_x is not None:
                bx, by = self.bounds["eye_x"], self.bounds["eye_y"]
                off = not (bx[0] <= obs.eye_x <= bx[1] and by[0] <= obs.eye_y <= by[1])
            changes += self._gaze.update(t, off)

            turned, detail = False, ""
            if one and obs.yaw is not None:
                dyaw, dpitch = obs.yaw - self.bounds["yaw"], obs.pitch - self.bounds["pitch"]
                turned = abs(dyaw) > i.head_yaw_deg or abs(dpitch) > i.head_pitch_deg
                detail = f"yaw {dyaw:+.0f}°, pitch {dpitch:+.0f}°"
            changes += self._head.update(t, turned, detail)

            changes += self._reading.update(t, one and self._reading_sweeps(t, obs.eye_x) >= i.reading_sweeps)

            if one and obs.mouth_open is not None:
                self._mouth.append((t, obs.mouth_open))
            while self._mouth and self._mouth[0][0] < t - 2:
                self._mouth.popleft()
            changes += self._lipsync.update(t, one and self._lips_still_while_speaking(t))

        if obs.objects_ok:
            seen = {o["label"] for o in obs.objects}
            self._recent_objects.append(seen)
            self._recent_persons.append(obs.persons or 0)
            for label, cond in self._objects.items():
                hits = sum(label in s for s in self._recent_objects)
                conf = max((o["conf"] for o in obs.objects if o["label"] == label), default=0.0)
                changes += cond.update(t, hits >= i.object_frames, label, conf)
            hits = sum(p >= 2 for p in self._recent_persons)
            changes += self._person.update(t, hits >= i.object_frames, "2+ people")

        for c in changes:
            if c.kind == "open":
                self.flags.append(c.flag)
        return changes

    def on_speaker_check(self, start: float, end: float, similarity: float) -> Change | None:
        """A finished student speech segment compared with the enrolled voice print."""
        if similarity >= self.cfg.integrity.speaker_similarity:
            return None
        flag = Flag(
            "secondary_speaker",
            start,
            end,
            round(1 - similarity, 2),
            f"voice match {similarity:.2f}",
            closed=True,
        )
        self.flags.append(flag)
        return Change("open", flag)

    def close_all(self, t: float) -> list[Change]:
        conds = [
            self._gaze,
            self._head,
            self._no_face,
            self._faces,
            self._reading,
            self._lipsync,
            self._person,
        ]
        return [c for cond in conds + list(self._objects.values()) for c in cond.update(t, False)]

    # ---------- detectors over time ----------

    def _reading_sweeps(self, t: float, eye_x: float | None) -> int:
        """Left-right sweeps in the window: passes of the eyes across >= 0.15, two passes per sweep."""
        window = self.cfg.integrity.reading_window_seconds
        if eye_x is not None:
            self._eyes.append((t, eye_x))
        while self._eyes and self._eyes[0][0] < t - window:
            self._eyes.popleft()
        passes, anchor, direction = 0, None, 0
        for _, x in self._eyes:
            if anchor is None:
                anchor = x
                continue
            d = x - anchor
            if direction >= 0 and d <= -0.15 or direction <= 0 and d >= 0.15:
                passes += 1
                direction = -1 if d < 0 else 1
                anchor = x
            elif direction * d > 0:
                anchor = x  # still moving the same way: extend the pass
        return passes // 2

    def _lips_still_while_speaking(self, t: float) -> bool:
        window = [s for ts, s in self._voice if ts >= t - 2]
        mouth = [m for _, m in self._mouth]
        if len(window) < 5 or len(mouth) < 5:
            return False
        speaking = sum(window) / len(window) >= 0.6
        still = max(mouth) < 0.12 and statistics.pstdev(mouth) < 0.025
        return speaking and still

    # ---------- score ----------

    def risk(self, now: float) -> float:
        """Weighted sum of recent flags, capped at 100. Also tracks the session's peak."""
        weights, window = self.cfg.risk_weights, self.cfg.risk_window_seconds
        total = 0.0
        for f in self.flags:
            end = f.end if f.closed else now
            if end >= now - window:
                total += weights.get(f.type, 5) * (1 + max(0.0, end - f.start) / 10)
        score = min(100.0, round(total, 1))
        self.peak_risk = max(self.peak_risk, score)
        return score
