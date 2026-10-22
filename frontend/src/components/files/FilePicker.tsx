"use client";

import { useRef } from "react";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FileIcon, UploadIcon, XIcon } from "@/components/ui/Icons";

/** Choose files to send with a form. Nothing uploads until the form is submitted. */
export function FilePicker({
  files,
  onChange,
  accept,
  multiple = true,
  label = "Attach files",
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
        <UploadIcon className="h-3.5 w-3.5" /> {label}
      </Button>
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          onChange(multiple ? [...files, ...picked] : picked.slice(0, 1));
          e.target.value = "";
        }}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2 py-1 text-xs"
            >
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="truncate">{f.name}</span>
              <span className="text-subtle">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="rounded p-0.5 text-subtle hover:text-danger"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
