import { useState } from "react";
import { Button } from "@/components/ui/button";
import { costPerWear, money } from "@/lib/look";
import { HOUSE_LABEL, daysIdle, housesOf } from "@/lib/style";
import type { Garment } from "@/lib/types";
import { useCloset } from "@/lib/store";
import { todayISO } from "@/lib/utils";

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
  const cpw = costPerWear(garment);

  const commitPaid = () => {
    const n = parseFloat(paid);
    const next = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
    if (next !== garment.paid) updateGarment(garment.id, { paid: next });
    setPaid(next != null ? String(next) : "");
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
        <div className="bg-paper-deep aspect-page">
          <img
            src={garment.cutoutSrc || garment.imageSrc}
            alt={garment.name}
            className="h-full w-full object-contain p-[8%]"
          />
        </div>
        <div className="p-6 flex flex-col gap-4">
          <p className="micro text-ink-soft">{garment.category}</p>
          <h2 className="font-editorial text-3xl tracking-tight">{garment.name}</h2>
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
