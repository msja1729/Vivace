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
    "tab_switch": "Left the viva (another tab or app)",
    "left_fullscreen": "Left full screen",
}

AWAY_KINDS = ("tab_switch", "left_fullscreen")  # reported by the student's browser, not the camera

# How each flag reads in the report's one-line integrity summary.
SUMMARY_PHRASE = {
    "gaze_off_screen": "looked away from the screen",
    "head_turned": "turned their head away",
    "reading_pattern": "seemed to read from something",
    "no_face": "left the camera's view",
    "multiple_faces": "had another face in view",
    "prohibited_object": "had a phone, book or device in view",
    "second_person": "had another person in view",
    "secondary_speaker": "had another voice speaking",
    "lipsync_mismatch": "had speech heard while their lips were still",
    "tab_switch": "left the viva for another tab or app",
    "left_fullscreen": "left full screen",
}
SERIOUS = {
    "second_person",
    "multiple_faces",
    "secondary_speaker",
    "prohibited_object",
    "lipsync_mismatch",
    "tab_switch",
}


def integrity_summary(
    events: list[tuple[str, float, float]], risk: float, proctor_frames: int, face_frames: int
) -> dict:
    """One or two plain sentences on whether the student genuinely attended, from the flags
    (type, start, end) and how much video the proctoring saw. level: clear | minor | concerns | unverified."""
    if proctor_frames < 25:  # under ~5 s of video: nothing to judge by
        return {
            "level": "unverified",
            "text": "Integrity couldn't be checked: the proctoring received little or no video from the student.",
        }
    on_camera = face_frames / proctor_frames
    if not events:
        text = "Attended genuinely: the student stayed on camera, alone and facing the screen, with nothing suspicious."
        if on_camera < 0.9:
            text = "No integrity flags, but the student's face was only in view for part of the interview."
        return {"level": "clear" if on_camera >= 0.9 else "minor", "text": text}

    counts: dict[str, list[float]] = {}
    for kind, start, end in events:
        counts.setdefault(kind, []).append(max(0.0, end - start))
    parts = []
    for kind, spans in sorted(counts.items(), key=lambda kv: (kv[0] not in SERIOUS, -len(kv[1]))):
        n = len(spans)
        times = "once" if n == 1 else "twice" if n == 2 else f"{n} times"
        parts.append(f"{SUMMARY_PHRASE.get(kind, kind.replace('_', ' '))} {times} ({round(sum(spans))} s)")
    listed = "; ".join(parts)
    if risk >= 30 or SERIOUS & counts.keys():
        return {
            "level": "concerns",
            "text": f"Integrity concerns: the student {listed}. Review these before deciding.",
        }
    return {
        "level": "minor",
        "text": f"Attended genuinely, with minor moments: the student {listed}. Nothing points to cheating.",
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
        # Looking up is what people do while thinking (notes are never on the ceiling): it needs longer.
        self._gaze_up = _Condition("gaze_off_screen", i.gaze_up_seconds)
        self._head = _Condition("head_turned", i.head_turn_seconds)
        self._no_face = _Condition("no_face", i.no_face_seconds)
        self._faces = _Condition("multiple_faces", 1.0)  # a whole second, not a detector glitch
        self._reading = _Condition("reading_pattern", 0)
        self._lipsync = _Condition("lipsync_mismatch", i.lipsync_seconds)
        self._person = _Condition("second_person", 1.5)  # stays a while; a flickering shadow doesn't
        self._objects = {label: _Condition("prohibited_object", 0) for label in i.objects}

        self._recent_objects: deque[set[str]] = deque(maxlen=5)
        self._recent_persons: deque[int] = deque(maxlen=5)
        self._eyes: deque[tuple[float, float]] = deque()  # (t, eye_x)
        self._reading_paused_until = 0.0
        self._low_voice: Flag | None = None  # a voice check that didn't match, waiting for a second one
        self._away: dict[str, Flag] = {}  # open "left the viva" flags, by kind
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

    def pause_reading(self, until: float) -> None:
        """A question is on the student's screen: reading it is expected, not a flag."""
        self._reading_paused_until = max(self._reading_paused_until, until)
        self._eyes.clear()

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

            off = up = False
            if one and obs.eye_x is not None:
                bx, by = self.bounds["eye_x"], self.bounds["eye_y"]
                off = not (bx[0] <= obs.eye_x <= bx[1]) or obs.eye_y < by[0]
                up = not off and obs.eye_y > by[1]
            changes += self._gaze.update(t, off)
            changes += self._gaze_up.update(t, up, "looking up")

            turned, detail = False, ""
            if one and obs.yaw is not None:
                dyaw, dpitch = obs.yaw - self.bounds["yaw"], obs.pitch - self.bounds["pitch"]
                turned = abs(dyaw) > i.head_yaw_deg or abs(dpitch) > i.head_pitch_deg
                detail = f"yaw {dyaw:+.0f}°, pitch {dpitch:+.0f}°"
            changes += self._head.update(t, turned, detail)

            reading = one and self._reading_lines(t, obs.eye_x) >= i.reading_sweeps
            changes += self._reading.update(t, reading and t >= self._reading_paused_until)

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

    def on_away(self, t: float, kind: str, away: bool) -> list[Change]:
        """The student's browser reports leaving the viva (another tab or app, or out of full screen)
        and coming back. Each time away is one flag, from leaving until returning."""
        if kind not in AWAY_KINDS:
            return []
        flag = self._away.get(kind)
        if away and flag is None:
            flag = Flag(kind, t, t)
            self._away[kind] = flag
            self.flags.append(flag)
            return [Change("open", flag)]
        if not away and flag is not None:
            del self._away[kind]
            flag.end, flag.closed = max(flag.end, t), True
            return [Change("close", flag)]
        return []

    @property
    def away_now(self) -> list[str]:
        return list(self._away)

    def on_speaker_check(self, start: float, end: float, similarity: float) -> Change | None:
        """A finished student speech segment compared with the enrolled voice print.

        A genuine speaker matches poorly now and then (short clip, noise, a cough), so a flag needs
        two poor matches in a row, less than 30 s apart. It covers both segments."""
        if similarity >= self.cfg.integrity.speaker_similarity:
            self._low_voice = None
            return None
        detail = f"voice match {similarity:.2f}"
        prev = self._low_voice
        if prev is None or start - prev.end > 30:
            self._low_voice = Flag(
                "secondary_speaker", start, end, round(1 - similarity, 2), detail, closed=True
            )
            return None
        self._low_voice = None
        conf = max(prev.confidence, round(1 - similarity, 2))
        flag = Flag(
            "secondary_speaker", prev.start, end, conf, f"{prev.detail}, then {similarity:.2f}", closed=True
        )
        self.flags.append(flag)
        return Change("open", flag)

    def close_all(self, t: float) -> list[Change]:
        conds = [
            self._gaze,
            self._gaze_up,
            self._head,
            self._no_face,
            self._faces,
            self._reading,
            self._lipsync,
            self._person,
        ]
        changes = [c for cond in conds + list(self._objects.values()) for c in cond.update(t, False)]
        for kind in list(self._away):
            changes += self.on_away(t, kind, False)
        return changes

    # ---------- detectors over time ----------

    def _reading_lines(self, t: float, eye_x: float | None) -> int:
        """Lines of text read within the window.

        Reading has a signature that looking around while talking doesn't: the eyes travel slowly
        across a line in one direction, then jump back quickly, again and again. Glances are quick
        jumps both ways. Eye positions are median-smoothed (the model jitters by ~0.03), and a line
        must cover a good part of the calibrated screen width."""
        window = self.cfg.integrity.reading_window_seconds
        if eye_x is not None:
            self._eyes.append((t, eye_x))
        while self._eyes and self._eyes[0][0] < t - window:
            self._eyes.popleft()
        pts = list(self._eyes)
        if len(pts) < 5:
            return 0
        xs = [statistics.median(p[1] for p in pts[max(0, k - 1) : k + 2]) for k in range(len(pts))]
        bx = self.bounds["eye_x"]
        span = max(0.4, (bx[1] - bx[0] - 0.24) / 1.5)  # screen width in eye units (undo calibration padding)
        min_line, turn = max(0.2, 0.3 * span), 0.1

        def run(a: int, b: int) -> tuple[float, float, float]:
            """(amplitude, seconds, biggest single step). Reading moves in many small steps; glances
            jump. Hopping between two or three spots on the screen has big steps, so it isn't a line."""
            steps = [abs(xs[k + 1] - xs[k]) for k in range(a, b)]
            return abs(xs[b] - xs[a]), pts[b][0] - pts[a][0], max(steps, default=0.0)

        # Split the track into runs that move one way; a run ends when the eyes come back by > `turn`.
        runs: list[tuple[float, float]] = []
        start, peak, direction = 0, 0, 0
        for k in range(1, len(xs)):
            d = xs[k] - xs[peak]
            if direction == 0:
                if abs(xs[k] - xs[start]) > turn:
                    direction, peak = (1 if xs[k] > xs[start] else -1), k
            elif direction * d >= 0:
                peak = k
            elif -direction * d > turn:
                runs.append(run(start, peak))
                start, peak, direction = peak, k, -direction
        lines = 0
        for (across, across_s, across_step), (back, _, back_step) in zip(runs, runs[1:], strict=False):
            slow_across = across >= min_line and across_s >= 0.8 and across_step <= 0.35 * across
            quick_back = back >= 0.6 * across and back_step >= 0.5 * back
            lines += slow_across and quick_back
        return lines

    def _lips_still_while_speaking(self, t: float) -> bool:
        window = [s for ts, s in self._voice if ts >= t - 2]
        mouth = [m for _, m in self._mouth]
        if len(window) < 5 or len(mouth) < 5:
            return False
        speaking = sum(window) / len(window) >= 0.6
        # Speech is impossible with the lips shut, so only a closed, unmoving mouth counts.
        still = max(mouth) < 0.05 and statistics.pstdev(mouth) < 0.015
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
