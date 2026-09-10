import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GarmentTile } from "@/components/closet/tile";
import { FitBoard } from "@/components/closet/fit";
import { LookStack } from "@/components/closet/look-stack";
import { OnMeButton } from "@/components/closet/on-me";
import { Button } from "@/components/ui/button";
import { nameLook } from "@/lib/look";
import { useCloset } from "@/lib/store";

export const Route = createFileRoute("/outfits")({ component: OutfitsPage });

function OutfitsPage() {
  const looks = useCloset((s) => s.looks);
  const garmentsAll = useCloset((s) => s.garments);
  const garments = useMemo(
    () => garmentsAll.filter((g) => !g.archived),
    [garmentsAll],
  );
  const removeLook = useCloset((s) => s.removeLook);
  const saveLook = useCloset((s) => s.saveLook);
  const drop = useCloset((s) => s.drop);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [occasion, setOccasion] = useState("");

  const selected = garments.filter((g) => picked.includes(g.id));
  const draftName = name.trim() || nameLook(selected);

  const toggle = (id: string) => {
    setPicked((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  };

  const keep = () => {
    if (picked.length < 2) return;
    saveLook({
      name: draftName,
      occasion: occasion.trim() || "composed",
      garmentIds: picked,
      source: "manual",
    });
    setPicked([]);
    setName("");
    setOccasion("");
  };

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Looks</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        Saved outfits
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        Tap pieces you own. Save the look. Nothing fabricated.
      </p>

      {garments.length === 0 && (
        <div className="mt-10 border border-hairline bg-card px-4 py-5">
          <p className="text-sm text-ink-soft">
            No pieces to compose. Photograph the closet first.
          </p>
          <Link
            to="/add"
            className="mt-4 inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
          >
            Add a piece
          </Link>
        </div>
      )}

      <section className="mt-10 border border-hairline bg-card px-4 py-5 md:px-6">
        <p className="micro text-ink-soft">Compose</p>
        <p className="mt-1 font-editorial text-2xl tracking-tight">
          {selected.length ? draftName : "Tap two or more pieces."}
        </p>
        <ul className="mt-5 grid grid-cols-3 md:grid-cols-6 gap-3">
          {garments.map((g) => (
            <li key={g.id}>
              <GarmentTile
                garment={g}
                selected={picked.includes(g.id)}
                onClick={() => toggle(g.id)}
              />
            </li>
          ))}
        </ul>
        {selected.length >= 2 && (
          <FitBoard pieces={selected} className="mt-5 max-w-xs" />
        )}
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this look"
            className="h-11 flex-1 border border-hairline bg-paper px-3 text-sm"
          />
          <input
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder="Occasion"
            className="h-11 sm:w-48 border border-hairline bg-paper px-3 text-sm"
          />
          <Button onClick={keep} disabled={picked.length < 2}>
            Save look
          </Button>
        </div>
      </section>

      {drop && drop.garmentIds.length > 0 && (
        <button
          type="button"
          className="mt-6 micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
          onClick={() =>
            saveLook({
              name: "Today’s drop",
              occasion: "daily",
              garmentIds: drop.garmentIds,
              source: "ai",
            })
          }
        >
          Save today’s drop
        </button>
      )}

      <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {looks.map((look) => {
          const pieces = look.garmentIds
            .map((id) => garments.find((g) => g.id === id))
            .filter((g): g is NonNullable<typeof g> => Boolean(g));
          return (
            <li key={look.id}>
              {pieces.length >= 2 ? (
                <FitBoard pieces={pieces} />
              ) : (
                <LookStack pieces={pieces} />
              )}
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <p>{look.name}</p>
                  <p className="micro text-ink-soft">
                    {look.occasion}
                    {look.source === "manual" ? " · composed" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pieces.length > 0 && <OnMeButton pieces={pieces} />}
                  <button
                    type="button"
                    className="micro text-ink-soft hover:text-accent"
                    onClick={() => removeLook(look.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
