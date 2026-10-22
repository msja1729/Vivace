"use client";

import { useEffect, useState } from "react";
import type { StoredFile, StudentWork } from "@/types";
import { downloadFile, fileObjectUrl } from "@/lib/api/files";
import { getStudentWork } from "@/lib/api/vivas";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { FormError } from "@/components/ui/Field";

const TEXT_EXT = /\.(txt|md|py|js|ts|tsx|jsx|java|c|cpp|h|cs|go|rs|rb|php|json|ya?ml|csv|sql|sh|html|css|ipynb)$/i;

type Preview = { kind: "pdf" | "image"; url: string } | { kind: "text"; text: string } | { kind: "none" };

/** What the student handed in, to open right here during the viva (PDFs, images and text show inline). */
export function StudentWorkPanel({ vivaId, studentId }: { vivaId: string; studentId: string }) {
  const [work, setWork] = useState<StudentWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<StoredFile | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    getStudentWork(vivaId, studentId).then(setWork, (e: Error) => setError(e.message));
  }, [vivaId, studentId]);

  // Load the chosen file; object URLs are revoked when another file is opened or the panel goes away.
  useEffect(() => {
    if (!open) return;
    let url = "";
    let cancelled = false;
    const isPdf = open.contentType === "application/pdf" || /\.pdf$/i.test(open.name);
    const isImage = open.contentType.startsWith("image/");
    const isText = open.contentType.startsWith("text/") || TEXT_EXT.test(open.name);
    if (!isPdf && !isImage && !isText) return;
    fileObjectUrl(open.id).then(
      async (u) => {
        url = u;
        if (cancelled) return URL.revokeObjectURL(u);
        if (isText) {
          const text = await (await fetch(u)).text();
          if (!cancelled) setPreview({ kind: "text", text: text.slice(0, 200_000) });
        } else setPreview({ kind: isPdf ? "pdf" : "image", url: u });
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open]);

  function choose(f: StoredFile) {
    setError(null);
    const viewable =
      f.contentType === "application/pdf" || /\.pdf$/i.test(f.name) || f.contentType.startsWith("image/") ||
      f.contentType.startsWith("text/") || TEXT_EXT.test(f.name);
    setPreview(viewable ? null : { kind: "none" });
    setOpen(f);
  }

  const nothing = work && !work.files.length && !work.links.length && !work.note;
  return (
    <Section
      title="Student's work"
      description={
        work?.assignmentTitle
          ? `${work.assignmentTitle}${work.submittedAt ? ` · handed in ${formatDateTime(work.submittedAt)}` : " · not handed in"}`
          : "Open their files here while you ask questions."
      }
    >
      <FormError message={error} />
      {!work && !error && <p className="text-sm text-muted">Loading…</p>}
      {work && !work.assignmentTitle && (
        <p className="text-sm text-muted">This viva isn&apos;t linked to an assignment, so there are no submitted files.</p>
      )}
      {work?.assignmentTitle && nothing && <p className="text-sm text-muted">The student didn&apos;t hand anything in.</p>}

      {work && (work.files.length > 0 || work.links.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {work.files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => choose(f)}
              className={`max-w-full truncate rounded-full border px-3 py-1.5 text-xs transition ${
                open?.id === f.id ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-tint hover:bg-raised"
              }`}
            >
              {f.name}
            </button>
          ))}
          {work.links.map((l) => (
            <a
              key={l}
              href={l}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate rounded-full border border-border-strong bg-tint px-3 py-1.5 text-xs text-accent hover:bg-raised"
            >
              {l.replace(/^https?:\/\/(www\.)?/, "")} ↗
            </a>
          ))}
        </div>
      )}
      {work?.note && <p className="mt-3 rounded-xl border border-border bg-tint p-3 text-sm whitespace-pre-line">{work.note}</p>}

      {open && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{open.name}</p>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => void downloadFile(open.id, open.name)}>
                Download
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
          </div>
          {!preview && <p className="text-sm text-muted">Opening…</p>}
          {preview?.kind === "pdf" && (
            <iframe src={preview.url} title={open.name} className="h-[70vh] w-full rounded-xl border border-border bg-white" />
          )}
          {preview?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch
            <img src={preview.url} alt={open.name} className="max-h-[70vh] w-full rounded-xl object-contain" />
          )}
          {preview?.kind === "text" && (
            <pre className="h-[70vh] overflow-auto rounded-xl border border-border bg-tint p-4 text-xs leading-relaxed whitespace-pre-wrap">
              {preview.text}
            </pre>
          )}
          {preview?.kind === "none" && (
            <p className="text-sm text-muted">This kind of file can&apos;t be shown here. Use Download to open it.</p>
          )}
        </div>
      )}
    </Section>
  );
}
