"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  UploadCloud,
  Camera,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Stage = "queued" | "uploading" | "identifying" | "done" | "error";

interface FileState {
  id: string;
  name: string;
  stage: Stage;
  progress: number; // 0..100 during upload
  count: number; // garments added
  error?: string;
}

interface IngestResponse {
  ok?: boolean;
  count?: number;
  error?: string;
}

// Upload one file via XHR so we can distinguish the upload phase from the
// server-side identify phase (uploading -> identifying -> done).
function ingestFile(
  file: File,
  onStage: (patch: Partial<FileState>) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/ingest");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onStage({
          stage: "uploading",
          progress: Math.round((e.loaded / e.total) * 100),
        });
      }
    };
    // Bytes are on the server; the vision call is now running.
    xhr.upload.onload = () => onStage({ stage: "identifying", progress: 100 });

    xhr.onload = () => {
      let body: IngestResponse = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.ok) {
        onStage({ stage: "done", count: body.count ?? 0 });
      } else {
        onStage({ stage: "error", error: body.error ?? `Failed (${xhr.status})` });
      }
      resolve();
    };
    xhr.onerror = () => {
      onStage({ stage: "error", error: "Network error" });
      resolve();
    };

    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

function StageLabel({ f }: { f: FileState }) {
  switch (f.stage) {
    case "queued":
      return <span className="text-neutral-500">Queued</span>;
    case "uploading":
      return (
        <span className="text-neutral-300">Uploading… {f.progress}%</span>
      );
    case "identifying":
      return <span className="text-neutral-300">Identifying…</span>;
    case "done":
      return (
        <span className="text-emerald-400">
          {f.count} {f.count === 1 ? "garment" : "garments"} added
        </span>
      );
    case "error":
      return <span className="text-red-400">{f.error}</span>;
  }
}

export function Uploader() {
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    const list = Array.from(picked);
    const initial: FileState[] = list.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      stage: "queued",
      progress: 0,
      count: 0,
    }));
    setFiles((prev) => [...initial, ...prev]);
    setBusy(true);

    const patch = (id: string, p: Partial<FileState>) =>
      setFiles((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...p } : s)),
      );

    // Process the whole batch concurrently; one failure never kills the rest.
    await Promise.all(
      list.map((file, i) => ingestFile(file, (p) => patch(initial[i].id, p))),
    );
    setBusy(false);
  }, []);

  const doneCount = files
    .filter((f) => f.stage === "done")
    .reduce((sum, f) => sum + f.count, 0);
  const allSettled =
    files.length > 0 &&
    files.every((f) => f.stage === "done" || f.stage === "error");

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => pickRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center transition-colors",
          dragging
            ? "border-neutral-400 bg-neutral-900"
            : "border-neutral-700 bg-neutral-900/40 hover:border-neutral-500",
        )}
      >
        <UploadCloud className="mb-3 size-8 text-neutral-400" aria-hidden />
        <p className="text-sm font-medium text-neutral-200">
          Tap to choose photos, or drop them here
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Add several at once — one item or a whole outfit per photo.
        </p>
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => pickRef.current?.click()}
        >
          <UploadCloud aria-hidden /> Choose photos
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera aria-hidden /> Take a photo
        </Button>
      </div>

      {/* Multi-select from library */}
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {/* Mobile camera capture */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2.5"
            >
              <span className="shrink-0">
                {f.stage === "done" ? (
                  <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
                ) : f.stage === "error" ? (
                  <AlertCircle className="size-4 text-red-400" aria-hidden />
                ) : (
                  <Loader2
                    className="size-4 animate-spin text-neutral-400"
                    aria-hidden
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-300">
                {f.name}
              </span>
              <span className="shrink-0 text-xs">
                <StageLabel f={f} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {allSettled && !busy && (
        <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
          <p className="text-sm text-neutral-300">
            {doneCount} {doneCount === 1 ? "garment" : "garments"} added.
          </p>
          <Button asChild size="sm">
            <Link href="/closet">View closet</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
