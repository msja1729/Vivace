"use client";

import { useState } from "react";
import type { ClassRoom } from "@/types";
import { listClassFiles } from "@/lib/api/files";
import { formatBytes, formatDate } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { FileChip } from "@/components/files/FileChip";
import { EmptyState, Loading, PageHeader } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { FolderIcon } from "@/components/ui/Icons";
import { SearchInput, matches } from "@/components/ui/SearchInput";

/** Files the instructor shared with the class. Other students' uploads are never listed here. */
export function StudentFiles({ cls }: { cls: ClassRoom }) {
  const { data, error } = useLoad(() => listClassFiles(cls.id), cls.id);
  const [query, setQuery] = useState("");
  const shown = data?.filter((f) => matches(query, f.name, f.uploaderName)) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={cls.name} title="Files" description="Material your instructor shared with the class." />
      <FormError message={error} />
      {data === undefined ? (
        !error && <Loading />
      ) : data.length === 0 ? (
        <EmptyState icon={<FolderIcon className="h-6 w-6" />} title="No files yet" description="Files your instructor posts will appear here." />
      ) : (
        <div className="panel overflow-hidden rounded-xl">
          <div className="border-b border-border p-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Search files" />
          </div>
          <ul className="divide-y divide-border">
            {shown.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <FileChip file={f} />
                <span className="text-xs text-muted">
                  {f.uploaderName} · {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No files match “{query}”.</p>}
        </div>
      )}
    </div>
  );
}
