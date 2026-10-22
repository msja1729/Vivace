"use client";

import { useState } from "react";
import type { StoredFile } from "@/types";
import { downloadFile } from "@/lib/api/files";
import { formatBytes } from "@/lib/format";
import { DownloadIcon } from "@/components/ui/Icons";

/** A file name that downloads the file when clicked. */
export function FileChip({ file, label }: { file: StoredFile; label?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <button
      type="button"
      title={state === "error" ? "Download failed, try again" : `Download ${file.name} (${formatBytes(file.sizeBytes)})`}
      onClick={async () => {
        setState("busy");
        try {
          await downloadFile(file.id, file.name);
          setState("idle");
        } catch {
          setState("error");
        }
      }}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition hover:border-accent hover:text-text ${
        state === "error" ? "border-danger/40 text-danger" : "border-border-strong text-muted"
      }`}
    >
      <DownloadIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{state === "busy" ? "Downloading…" : (label ?? file.name)}</span>
    </button>
  );
}
