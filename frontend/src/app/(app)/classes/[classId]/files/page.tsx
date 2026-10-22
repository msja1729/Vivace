"use client";

import { useRef, useState } from "react";
import { isStaff, type ClassRoom, type FileKind, type StoredFile } from "@/types";
import { deleteFile, listClassFiles, uploadMaterial } from "@/lib/api/files";
import { formatBytes, formatDate } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { ClassPage } from "@/components/classes/ClassPage";
import { StudentFiles } from "@/components/student/StudentFiles";
import { FileChip } from "@/components/files/FileChip";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Badge, EmptyState, Loading, PageHeader } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { FolderIcon, UploadIcon } from "@/components/ui/Icons";
import { SearchInput, matches } from "@/components/ui/SearchInput";

export default function FilesPage() {
  return <ClassPage>{(cls) => (isStaff(cls) ? <Files cls={cls} /> : <StudentFiles cls={cls} />)}</ClassPage>;
}

const KINDS: { value: FileKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submission", label: "Student work" },
  { value: "viva_instructions", label: "Viva instructions" },
  { value: "material", label: "Class material" },
  { value: "feedback", label: "Feedback" },
];

const KIND_BADGE: Record<FileKind, React.ReactNode> = {
  submission: <Badge tone="accent">Student work</Badge>,
  resume: <Badge tone="accent">Student work</Badge>,
  transcript: <Badge tone="accent">Student work</Badge>,
  viva_instructions: <Badge tone="warning">Viva instructions</Badge>,
  material: <Badge tone="success">Material</Badge>,
  feedback: <Badge>Assignment feedback</Badge>,
  viva_feedback: <Badge>Viva feedback</Badge>,
};

// "Student work" also covers files from the older resume / transcript slots;
// "Feedback" covers both assignment and viva feedback files.
const ofKind = (f: StoredFile, k: FileKind | "all") =>
  k === "all" ||
  f.kind === k ||
  (k === "submission" && (f.kind === "resume" || f.kind === "transcript")) ||
  (k === "feedback" && f.kind === "viva_feedback");

function Files({ cls }: { cls: ClassRoom }) {
  const { data, error, setData } = useLoad(() => listClassFiles(cls.id), cls.id);
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files?.length || !data) return;
    setBusy(true);
    setActionError(null);
    try {
      setData([...(await uploadMaterial(cls.id, Array.from(files))), ...data]);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(file: StoredFile) {
    setActionError(null);
    try {
      await deleteFile(file.id);
      setData((data ?? []).filter((f) => f.id !== file.id));
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  const shown =
    data?.filter((f) => ofKind(f, kind) && matches(query, f.name, f.context, f.uploaderName)) ?? [];
  const count = (k: FileKind | "all") => data?.filter((f) => ofKind(f, k)).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={cls.name}
        title="Files"
        description="Everything in this class. Students only see the class material you upload here, plus feedback returned to them."
        actions={
          <>
            <Button disabled={busy || !data} onClick={() => input.current?.click()}>
              <UploadIcon /> {busy ? "Uploading…" : "Upload material"}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.txt,.md"
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
          </>
        }
      />
      <FormError message={error ?? actionError} />

      {data === undefined ? (
        !error && <Loading />
      ) : data.length === 0 ? (
        <EmptyState
          icon={<FolderIcon className="h-6 w-6" />}
          title="No files yet"
          description="Student submissions and viva instruction files collect here automatically."
        />
      ) : (
        <div className="panel overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter files">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="tab"
                aria-selected={kind === k.value}
                onClick={() => setKind(k.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  kind === k.value ? "bg-raised text-text" : "text-muted hover:text-text"
                }`}
              >
                {k.label} <span className="ml-1 text-subtle tabular-nums">{count(k.value)}</span>
              </button>
            ))}
          </div>
          <SearchInput value={query} onChange={setQuery} placeholder="Search files or students" className="max-w-60" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">File</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">From</th>
                  <th className="px-4 py-2.5 font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">Uploaded</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((f) => (
                  <tr key={f.id} className="hover:bg-raised/50">
                    <td className="max-w-[16rem] px-4 py-3">
                      <FileChip file={f} />
                    </td>
                    <td className="px-4 py-3">{KIND_BADGE[f.kind]}</td>
                    <td className="max-w-[14rem] truncate px-4 py-3 text-muted" title={f.context ?? f.uploaderName}>
                      {f.context ?? f.uploaderName}
                    </td>
                    <td className="px-4 py-3 text-muted tabular-nums">{formatBytes(f.sizeBytes)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(f.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {f.kind === "material" && <ConfirmButton size="sm" label="Delete" onConfirm={() => remove(f)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted">{query ? `No files match “${query}”.` : "No files of this type."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
