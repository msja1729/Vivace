"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

type Away = "tab_switch" | "left_fullscreen";

// Keyboard Lock (Chrome, in full screen): Esc must then be held to leave, and some system keys are captured.
type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

/**
 * Keeps the student in the viva while the interview is live: full screen (covered until they enter it),
 * and the examiner is told each time they leave it or switch to another tab or app. Browsers don't let
 * a website fully block that, so it is detected and flagged rather than prevented. Released when the
 * interview ends.
 */
export function ExamLock({ live, report }: { live: boolean; report: (kind: Away, away: boolean) => void }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [entered, setEntered] = useState(false); // has been in full screen at least once
  const [error, setError] = useState<string | null>(null);
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  });

  useEffect(() => {
    if (!live) return;
    const away: Record<Away, boolean> = { tab_switch: false, left_fullscreen: false };
    const set = (kind: Away, value: boolean) => {
      if (away[kind] !== value) {
        away[kind] = value;
        reportRef.current(kind, value);
      }
    };

    const onFullscreen = () => {
      const on = !!document.fullscreenElement;
      setFullscreen(on);
      if (on) setEntered(true);
      set("left_fullscreen", !on && enteredOnce.current);
      if (on) enteredOnce.current = true;
    };
    const enteredOnce = { current: !!document.fullscreenElement };
    onFullscreen();

    // Another tab, app or window: the page is hidden, or the window loses focus for over a second.
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (document.hidden) return set("tab_switch", true);
      if (!document.hasFocus()) {
        if (!blurTimer) {
          blurTimer = setTimeout(() => {
            blurTimer = null;
            set("tab_switch", !document.hasFocus());
          }, 1000);
        }
        return;
      }
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = null;
      set("tab_switch", false);
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("blur", check);
    window.addEventListener("focus", check);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("blur", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("beforeunload", beforeUnload);
      if (blurTimer) clearTimeout(blurTimer);
      // The interview is over (or this page is going): release the student.
      keyboard()?.unlock?.();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [live]);

  async function enter() {
    setError(null);
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await keyboard()?.lock?.().catch(() => {});
    } catch {
      setError("Your browser didn't allow full screen. Press F11, or try again.");
    }
  }

  if (!live || fullscreen) return null;
  // On <body>: the overlay must cover the whole screen, not just the app's glass window.
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-bg/95 p-6 backdrop-blur">
      <div className="max-w-md space-y-4 text-center">
        <h2 className="text-xl font-semibold">{entered ? "Return to full screen" : "The interview has started"}</h2>
        <p className="text-sm text-muted">
          {entered
            ? "You left full screen. Your examiner has been told. Go back to continue the viva."
            : "The viva runs in full screen. Stay on this screen until your examiner ends the interview: leaving it, or switching to another tab or app, is reported to your examiner."}
        </p>
        <Button className="px-6 py-2.5" onClick={enter}>
          {entered ? "Return to full screen" : "Enter full screen"}
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
