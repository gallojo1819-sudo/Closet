import { useState } from "react";
import { GarmentImg } from "@/components/closet/gimg";
import { OnMePanel } from "@/components/closet/on-me";
import { Button } from "@/components/ui/button";
import { costPerWear, money } from "@/lib/look";
import { HOUSE_LABEL, daysIdle, housesOf } from "@/lib/style";
import { CATEGORIES, type Category, type Garment } from "@/lib/types";
import { useCloset } from "@/lib/store";
import { useImageSrc } from "@/lib/use-image";
import { cn, todayISO } from "@/lib/utils";

export function GarmentDetail({
  garment,
  onClose,
}: {
  garment: Garment;
  onClose: () => void;
}) {
  const wearToday = useCloset((s) => s.wearToday);
  const removeGarment = useCloset((s) => s.removeGarment);
  const updateGarment = useCloset((s) => s.updateGarment);
  const worn = garment.wornOn.includes(todayISO());
  const [paid, setPaid] = useState(
    garment.paid != null ? String(garment.paid) : "",
  );
  const refPhoto = useCloset((s) => s.refPhoto);
  const [view, setView] = useState<"print" | "original" | "me">("print");
  const [name, setName] = useState(garment.name);
  const originalSrc = useImageSrc(garment.imageSrc);
  const usingOriginal = garment.cutoutSrc === garment.imageSrc;
  const cpw = costPerWear(garment);

  const commitPaid = () => {
    const n = parseFloat(paid);
    const next = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
    if (next !== garment.paid) updateGarment(garment.id, { paid: next });
    setPaid(next != null ? String(next) : "");
  };

  const commitName = () => {
    const next = name.trim();
    if (next && next !== garment.name) updateGarment(garment.id, { name: next });
    else setName(garment.name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-3xl max-h-[92dvh] overflow-auto bg-paper border border-hairline md:grid md:grid-cols-2">
        <div>
          {view === "me" ? (
            <OnMePanel pieces={[garment]} />
          ) : (
            <div className="bg-paper-deep aspect-page">
              {view === "print" ? (
                <GarmentImg
                  garment={garment}
                  className="h-full w-full object-contain p-[8%]"
                />
              ) : originalSrc ? (
                <img
                  src={originalSrc}
                  alt={garment.name}
                  className="h-full w-full object-contain p-[8%]"
                />
              ) : (
                <div className="h-full w-full" aria-hidden />
              )}
            </div>
          )}
          <div className="flex border-t border-hairline">
            {(["print", "original"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "micro flex-1 py-2",
                  view === v ? "bg-ink text-paper" : "text-ink-soft",
                )}
              >
                {v === "print" ? "Print" : "Original"}
              </button>
            ))}
            {refPhoto && (
              <button
                type="button"
                onClick={() => setView("me")}
                className={cn(
                  "micro flex-1 py-2",
                  view === "me" ? "bg-ink text-paper" : "text-ink-soft",
                )}
              >
                On me
              </button>
            )}
          </div>
          {!usingOriginal && view !== "me" && (
            <button
              type="button"
              onClick={() => {
                updateGarment(garment.id, { cutoutSrc: garment.imageSrc });
                setView("original");
              }}
              className="micro w-full py-2 text-ink-soft border-t border-hairline hover:text-ink"
            >
              Use my photo — the print lies
            </button>
          )}
        </div>
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <select
              value={garment.category}
              onChange={(e) =>
                updateGarment(garment.id, {
                  category: e.target.value as Category,
                })
              }
              className="micro border border-hairline bg-card px-2 py-1 text-ink-soft"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label="Name"
            className="font-editorial text-3xl tracking-tight bg-transparent border-b border-transparent hover:border-hairline focus:border-hairline-strong focus:outline-none w-full"
          />
          {garment.demo && (
            <p className="text-sm text-ink-soft">
              Sample piece — not from your closet. Add a photo of the real thing
              to replace this look.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="micro text-ink-soft">Subtype</dt>
              <dd>{garment.subtype || "—"}</dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Material</dt>
              <dd>{garment.material || "—"}</dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Color</dt>
              <dd>{garment.colors.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Fit</dt>
              <dd>{garment.fit || "regular"}</dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Worn</dt>
              <dd>
                {garment.wornOn.length} times
                {garment.wornOn.length === 0
                  ? " · never"
                  : ` · last ${daysIdle(garment)}d ago`}
              </dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">House</dt>
              <dd>{housesOf(garment).map((h) => HOUSE_LABEL[h]).join(" · ")}</dd>
            </div>
          </dl>
          <div>
            <label className="block">
              <span className="micro text-ink-soft">What you paid</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="—"
                className="mt-1 h-10 w-32 border border-hairline bg-card px-3 text-sm"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                onBlur={commitPaid}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            {cpw != null && (
              <p className="mt-1 text-sm text-ink-soft">
                {garment.wornOn.length === 0
                  ? `first wear ${money(garment.paid ?? 0)}`
                  : `cost per wear ${money(cpw)}`}
              </p>
            )}
          </div>
          {garment.notes && (
            <p className="text-sm text-ink-soft">{garment.notes}</p>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <Button onClick={() => wearToday([garment.id])} disabled={worn}>
              {worn ? "Worn today" : "I wore this"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                removeGarment(garment.id);
                onClose();
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
