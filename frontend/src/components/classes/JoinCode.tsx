"use client";

import { useState } from "react";
import { CopyIcon } from "@/components/ui/Icons";

/** The class join code with a copy button. */
export function JoinCode({ code, large = false }: { code: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      title="Copy join code"
      className="group inline-flex items-center gap-3 rounded-lg border border-border-strong bg-white/[0.04] px-3 py-1.5 transition hover:border-accent"
    >
      <span className={`font-mono font-bold tracking-[0.3em] ${large ? "text-3xl" : "text-lg"}`}>{code}</span>
      <span className="flex items-center gap-1 text-xs text-muted group-hover:text-text">
        <CopyIcon className="h-3.5 w-3.5" />
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
