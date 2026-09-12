import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { putImage } from "@/lib/images";
import { useCloset } from "@/lib/store";
import { useImageSrc } from "@/lib/use-image";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Today" },
  { to: "/closet", label: "Closet" },
  { to: "/add", label: "Add" },
  { to: "/lookbook", label: "Lookbook" },
  { to: "/outfits", label: "Outfits" },
  { to: "/stylist", label: "Stylist" },
];

const REF_KEY = "idb:me:ref";
const SAVE_ERR = "Could not save that photo.";

const refDialogOpeners = new Set<(open: boolean) => void>();

/** Open the On-me reference dialog from Today (or anywhere TopBar is mounted). */
export function openRefPhotoDialog() {
  for (const setOpen of refDialogOpeners) setOpen(true);
}

function imageFile(file: File | undefined | null): file is File {
  if (!file) return false;
  return !file.type || file.type.startsWith("image/");
}

function firstImageFile(files: FileList | null | undefined): File | undefined {
  return [...(files ?? [])].find(imageFile);
}

function imageFromClipboard(e: ClipboardEvent): File | undefined {
  const fromList = firstImageFile(e.clipboardData?.files);
  if (fromList) return fromList;
  for (const item of e.clipboardData?.items ?? []) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
}

async function fileToJpegBlob(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("load"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("blob"))),
      "image/jpeg",
      0.85,
    );
  });
  return blob;
}

function RefPhotoDialog({ onClose }: { onClose: () => void }) {
  const refPhoto = useCloset((s) => s.refPhoto);
  const setRefPhoto = useCloset((s) => s.setRefPhoto);
  const src = useImageSrc(refPhoto);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const shown = justSaved || src;

  useEffect(() => {
    return () => {
      if (justSaved) URL.revokeObjectURL(justSaved);
    };
  }, [justSaved]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!imageFile(file)) {
        setError(SAVE_ERR);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const blob = await fileToJpegBlob(file);
        await putImage(REF_KEY, blob);
        setRefPhoto(REF_KEY);
        setJustSaved((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch {
        setError(SAVE_ERR);
      } finally {
        setBusy(false);
      }
    },
    [setRefPhoto],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e);
      if (!file) return;
      e.preventDefault();
      void onFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative z-10 w-full max-w-sm bg-paper border border-hairline p-6"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void onFile(firstImageFile(e.dataTransfer.files));
        }}
      >
        <p className="micro text-ink-soft">On me · reference</p>
        <h2 className="mt-1 font-editorial text-2xl tracking-tight">
          One photo of you. 5′8, regular.
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Full body, plain background. Choose a photo, drop one here, or paste
          (Ctrl+V). It never leaves this browser — the preview dresses this
          man, not a stranger.
        </p>
        {shown ? (
          <img
            src={shown}
            alt="Your reference photo"
            className="mt-4 w-full aspect-[3/4] object-cover border border-hairline"
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="mt-4 w-full aspect-[3/4] border border-dashed border-hairline-strong text-sm text-ink-soft"
          >
            Drop or paste a full-body photo
          </button>
        )}
        {error && <p className="mt-3 micro text-accent">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="h-10 bg-accent px-4 text-sm text-paper disabled:opacity-40"
          >
            {busy ? "Saving…" : refPhoto ? "Replace photo" : "Choose photo"}
          </button>
          {refPhoto && (
            <button
              type="button"
              onClick={() => {
                setRefPhoto(null);
                setJustSaved((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return null;
                });
              }}
              className="h-10 border border-hairline px-4 text-sm text-ink-soft"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-10 border border-hairline px-4 text-sm text-ink-soft"
          >
            Close
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const night = pathname.startsWith("/stylist");
  const garments = useCloset((s) => s.garments);
  const count = garments.filter((g) => !g.archived).length;
  const sample = garments.some((g) => g.demo);
  const loadSample = useCloset((s) => s.loadSample);
  const emptyCloset = useCloset((s) => s.emptyCloset);
  const refPhoto = useCloset((s) => s.refPhoto);
  const [refOpen, setRefOpen] = useState(false);

  useEffect(() => {
    refDialogOpeners.add(setRefOpen);
    return () => {
      refDialogOpeners.delete(setRefOpen);
    };
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 inset-x-0 z-40 border-b",
        night
          ? "h-12 md:h-16 bg-night text-champagne border-champagne/20"
          : "h-12 md:h-16 bg-paper text-ink border-hairline",
      )}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-4 md:px-6">
        <Link
          to="/"
          className="font-editorial text-lg tracking-tight md:text-xl"
        >
          Closet
        </Link>
        <nav className="hidden md:flex items-center gap-5 ml-6 micro text-ink-soft">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "transition-opacity",
                  night && "text-champagne/70",
                  active
                    ? night
                      ? "text-champagne"
                      : "text-ink"
                    : "hover:opacity-80",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className={cn("micro hidden sm:inline", night ? "text-champagne/70" : "text-ink-soft")}>
            {count} pieces
          </span>
          <button
            type="button"
            onClick={() => setRefOpen(true)}
            title={refPhoto ? "Reference photo set" : "Set your reference photo"}
            className={cn(
              "micro shrink-0 border px-2 py-1",
              night ? "border-champagne/30 text-champagne/80" : "border-hairline text-ink-soft",
              !refPhoto && "border-dashed",
            )}
          >
            Fit · 5′8 reg
          </button>
          <Link
            to="/stylist"
            className={cn(
              "micro hidden md:inline h-8 px-3 inline-flex items-center",
              night ? "bg-champagne text-night" : "bg-accent text-paper",
            )}
          >
            Stylist
          </Link>
          {sample ? (
            <button
              type="button"
              onClick={() => {
                if (confirm("Remove the sample rack? Your photos stay if you’ve added any.")) emptyCloset();
              }}
              className={cn(
                "micro opacity-60 hover:opacity-100",
                night ? "text-champagne" : "text-ink-soft",
              )}
            >
              Clear sample
            </button>
          ) : count === 0 ? (
            <button
              type="button"
              onClick={() => loadSample()}
              className={cn(
                "micro opacity-60 hover:opacity-100",
                night ? "text-champagne" : "text-ink-soft",
              )}
            >
              Sample rack
            </button>
          ) : null}
        </div>
      </div>
      {refOpen && <RefPhotoDialog onClose={() => setRefOpen(false)} />}
    </header>
  );
}
