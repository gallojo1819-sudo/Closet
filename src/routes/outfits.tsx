import { createFileRoute } from "@tanstack/react-router";
import { LookStack } from "@/components/closet/look-stack";
import { useCloset } from "@/lib/store";

export const Route = createFileRoute("/outfits")({ component: OutfitsPage });

function OutfitsPage() {
  const looks = useCloset((s) => s.looks);
  const garments = useCloset((s) => s.garments);
  const removeLook = useCloset((s) => s.removeLook);
  const saveLook = useCloset((s) => s.saveLook);
  const drop = useCloset((s) => s.drop);

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Looks</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        Saved outfits
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        Composed from your real pieces — never a fabricated garment.
      </p>
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
              <LookStack pieces={pieces} />
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <p>{look.name}</p>
                  <p className="micro text-ink-soft">{look.occasion}</p>
                </div>
                <button
                  type="button"
                  className="micro text-ink-soft hover:text-accent"
                  onClick={() => removeLook(look.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
