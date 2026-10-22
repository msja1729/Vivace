"use client";

import { useState } from "react";
import { Button } from "./Button";

/** A destructive button that asks "Are you sure?" inline instead of a browser dialog. */
export function ConfirmButton({
  label,
  confirmLabel = "Yes, delete",
  onConfirm,
  size = "md",
  icon,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  size?: "sm" | "md";
  icon?: React.ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <Button variant="danger" size={size} onClick={() => setAsking(true)}>
        {icon}
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-muted">Sure?</span>
      <Button
        variant="danger"
        size={size}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? "Deleting…" : confirmLabel}
      </Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
