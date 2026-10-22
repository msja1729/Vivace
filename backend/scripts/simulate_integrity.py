"""Simulated vivas through the integrity rules: false alarms on honest students, and how often cheating
is caught. No camera or models needed.

    uv run python -m scripts.simulate_integrity            # 40 honest 20-minute sessions + cheating cases

The honest student's numbers come from measurements, not guesses:
- gaze jitter (sd ~0.035) and the spread of normal on-screen gaze (eye_x about -0.35..+0.4): the face
  model run on real webcam frames from a test session, with small camera-like variations;
- the calibration bounds: from that same session (glasses, laptop webcam);
- voice-print similarity: ECAPA on 2-6 s clips with laptop-like noise, echo and a different mic.
  Genuine speaker: median ~0.45, 5th percentile ~0.3. Another person: median ~0.08, max ~0.28.
"""

import argparse
import random
from collections import Counter
from collections.abc import Callable

from app.live.config import live_config
from app.live.integrity.rules import IntegrityMonitor
from app.live.integrity.vision import FrameObs

FPS = 5
CAL_BOUNDS = {"eye_x": [-1.153, 1.002], "eye_y": [-0.826, 0.177], "yaw": 1.0, "pitch": -3.7}


class Student:
    """One honest student at a laptop for `minutes`, as a stream of per-frame observations."""

    def __init__(self, rng: random.Random, minutes: float, low_jaw: bool):
        self.rng, self.n = rng, int(minutes * 60 * FPS)
        self.low_jaw = low_jaw  # talks with little jaw movement (like the measured student)
        self.events: list[tuple[int, int, str, dict]] = []  # injected cheating: (start, end, kind, args)

    def frames(self):
        r = self.rng
        gx, gy, hold = 0.0, -0.3, 0
        glance_left = 0  # frames left in a thinking / side glance
        glance = (0.0, 0.0)
        speaking_left, silent_left = 0, r.randint(10, 40)
        yaw, pitch = 1.0, -3.7
        for k in range(self.n):
            # Where the eyes are: fixations on the screen, plus the odd thinking glance.
            if glance_left == 0 and r.random() < 1 / (45 * FPS):  # about one a minute or so
                if r.random() < 0.75:  # look up to think, 1-8 s
                    glance = (r.uniform(-0.5, 0.5), r.uniform(0.3, 0.7))
                    glance_left = int(r.lognormvariate(0.9, 0.5) * FPS)
                else:  # quick look aside
                    glance = (r.choice([-1, 1]) * r.uniform(1.1, 1.5), r.uniform(-0.4, 0.0))
                    glance_left = int(r.uniform(0.4, 2.5) * FPS)
            if hold <= 0:
                gx, gy = r.uniform(-0.35, 0.4), r.uniform(-0.5, -0.1)
                hold = int(r.expovariate(1 / 1.2) * FPS) + 1
            hold -= 1
            ex, ey = glance if glance_left > 0 else (gx, gy)
            glance_left = max(0, glance_left - 1)
            ex += r.gauss(0, 0.035)
            ey += r.gauss(0, 0.025)
            if r.random() < 1 / (4 * FPS):  # blink: eyes read as looking down for a frame
                ey -= 0.3
            yaw += (1.0 - yaw) * 0.05 + r.gauss(0, 0.6)
            pitch += (-3.7 - pitch) * 0.05 + r.gauss(0, 0.6)

            # Talking in turns; the mouth moves while speaking.
            if speaking_left == 0 and silent_left == 0:
                speaking_left = int(r.uniform(3, 20) * FPS)
            if speaking_left:
                speaking_left -= 1
                if speaking_left == 0:
                    silent_left = int(r.uniform(2, 15) * FPS)
            else:
                silent_left = max(0, silent_left - 1)
            speaking = speaking_left > 0
            top = 0.07 if self.low_jaw else 0.2
            mouth = r.uniform(0.0, top) if speaking and r.random() < 0.85 else r.uniform(0.0, 0.01)

            faces = 0 if r.random() < 0.005 else 1  # the detector misses a frame now and then
            persons = 2 if r.random() < 0.01 else 1  # YOLO's odd double-count
            objects = (
                [{"label": "cell phone", "conf": 0.55, "box": [0, 0, 0.1, 0.1]}] if r.random() < 0.004 else []
            )

            obs = dict(
                eye_x=ex,
                eye_y=ey,
                yaw=yaw,
                pitch=pitch,
                mouth=mouth,
                faces=faces,
                persons=persons,
                objects=objects,
                speaking=speaking,
            )
            for start, end, kind, args in self.events:
                if start <= k < end:
                    CHEATS[kind](obs, k - start, args, r)
            yield k / FPS, obs


# ---------- cheating, applied on top of the honest stream ----------


def reading_notes(obs, i, args, r):
    """Reading a document: slow scan across a line (~2 s), quick jump back, next line."""
    line = int(2.4 * FPS)
    pos = i % line
    start, width = args["x0"], args["width"]
    obs["eye_x"] = (start + width * min(1.0, pos / (line - 2)) if pos < line - 1 else start) + r.gauss(
        0, 0.035
    )
    obs["eye_y"] = args["y"] + r.gauss(0, 0.025)


def phone_in_lap(obs, i, args, r):
    obs["eye_y"] = r.uniform(-1.1, -0.95)
    obs["pitch"] = -3.7 - r.uniform(10, 18)


def phone_in_view(obs, i, args, r):
    if r.random() < 0.7:
        obs["objects"] = [
            {"label": "cell phone", "conf": round(r.uniform(0.5, 0.85), 2), "box": [0, 0, 0.1, 0.1]}
        ]


def second_person(obs, i, args, r):
    obs["persons"] = 2 if r.random() < 0.8 else 1
    obs["faces"] = 2 if r.random() < 0.7 else 1


def lips_closed_voice(obs, i, args, r):
    obs["speaking"] = True
    obs["mouth"] = r.uniform(0.0, 0.01)


def looking_off_screen(obs, i, args, r):
    obs["eye_x"] = -1.4 + r.gauss(0, 0.05)


CHEATS: dict[str, Callable] = {
    "reading_notes": reading_notes,
    "phone_in_lap": phone_in_lap,
    "phone_in_view": phone_in_view,
    "second_person": second_person,
    "lips_closed_voice": lips_closed_voice,
    "looking_off_screen": looking_off_screen,
}
EXPECTED = {
    "reading_notes": "reading_pattern",
    "phone_in_lap": "gaze_off_screen",
    "phone_in_view": "prohibited_object",
    "second_person": "second_person",
    "lips_closed_voice": "lipsync_mismatch",
    "looking_off_screen": "gaze_off_screen",
    "other_voice": "secondary_speaker",
}


def run_session(
    make: Callable[[], IntegrityMonitor],
    student: Student,
    rng: random.Random,
    other_voice_at: float | None = None,
) -> list:
    m = make()
    m.bounds = dict(CAL_BOUNDS)
    seg_end = 0.0
    for t, o in student.frames():
        fo = FrameObs(
            faces=o["faces"],
            eye_x=o["eye_x"],
            eye_y=o["eye_y"],
            yaw=o["yaw"],
            pitch=o["pitch"],
            mouth_open=o["mouth"],
            objects=o["objects"],
            persons=o["persons"],
            face_ok=True,
            objects_ok=True,
        )
        for j in range(2):  # audio chunks arrive ~10 times a second
            m.on_voice(t + j * 0.1, o["speaking"])
        m.on_frame(t, fo)
        # Voice checks on finished answers (>= 2 s), every ~20 s of talk.
        if t >= seg_end + 20:
            other = other_voice_at is not None and other_voice_at <= t < other_voice_at + 60
            sim = rng.gauss(0.08, 0.07) if other else min(0.95, rng.gauss(0.45, 0.1))
            m.on_speaker_check(t - 4, t, sim)
            seg_end = t
    m.close_all(student.n / FPS)
    return m.flags


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=40)
    ap.add_argument("--minutes", type=float, default=20)
    args = ap.parse_args()
    cfg = live_config()
    make = lambda: IntegrityMonitor(cfg)  # noqa: E731
    report(make, args.sessions, args.minutes)


def report(make: Callable[[], IntegrityMonitor], sessions: int, minutes: float) -> None:
    rng = random.Random(7)
    honest: Counter[str] = Counter()
    any_flag = 0
    for s in range(sessions):
        flags = run_session(make, Student(rng, minutes, low_jaw=s % 2 == 0), rng)
        honest.update(f.type for f in flags)
        any_flag += bool(flags)
    print(f"Honest students: {sessions} sessions x {minutes:g} min (half of them low-jaw speakers)")
    print(f"  sessions with any flag: {any_flag}/{sessions}")
    for typ, n in sorted(honest.items(), key=lambda kv: -kv[1]):
        print(f"  {typ:20s} {n / sessions:.2f} per session")

    print("Cheating (each tried 20 times, inside an otherwise honest 3-min session):")
    for kind, seconds in [
        ("reading_notes", 20),
        ("phone_in_lap", 8),
        ("phone_in_view", 5),
        ("second_person", 4),
        ("lips_closed_voice", 6),
        ("looking_off_screen", 6),
        ("other_voice", 60),
    ]:
        caught = 0
        for _ in range(20):
            st = Student(rng, 3, low_jaw=rng.random() < 0.5)
            at = 60.0
            if kind != "other_voice":
                st.events.append(
                    (int(at * FPS), int((at + seconds) * FPS), kind, {"x0": -0.6, "width": 0.9, "y": -0.3})
                )
            flags = run_session(make, st, rng, other_voice_at=at if kind == "other_voice" else None)
            caught += any(f.type == EXPECTED[kind] and at - 5 <= f.start <= at + seconds + 30 for f in flags)
        print(f"  {kind:20s} ({seconds:>2} s)  caught {caught}/20")


if __name__ == "__main__":
    main()
