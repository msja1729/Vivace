"use client";

import { useSyncExternalStore } from "react";
import { readTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { MoonIcon, SunIcon } from "@/components/ui/Icons";

// On the server the theme isn't known yet; the button renders once it is.
const readServerTheme = (): Theme | null => null;

/** Sun / moon button that switches between light and dark mode. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, readServerTheme);
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`grid h-9 w-9 place-items-center rounded-full border border-border bg-tint text-muted transition hover:bg-raised hover:text-text ${className}`}
    >
      {theme === "dark" ? <SunIcon /> : theme === "light" ? <MoonIcon /> : null}
    </button>
  );
}
