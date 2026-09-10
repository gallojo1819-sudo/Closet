import type { Garment } from "@/lib/types";

type Slot = {
  z: number;
  left: string;
  top: string;
  width: string;
  height: string;
};

// Percentages of a 3/5 paper canvas. Photos sit in anatomical slots over the
// croquis — laid flat, never warped.
const SLOTS: Record<string, Slot> = {
  outerwear: { z: 1, left: "27%", top: "19%", width: "46%", height: "36%" },
  dress: { z: 2, left: "29%", top: "21%", width: "42%", height: "58%" },
  bottom: { z: 2, left: "31.5%", top: "49%", width: "37%", height: "38%" },
  top: { z: 3, left: "31%", top: "21%", width: "38%", height: "28%" },
  footwear: { z: 4, left: "33%", top: "87%", width: "34%", height: "10%" },
  accessory: { z: 5, left: "35%", top: "45%", width: "30%", height: "10%" },
};

function slotOf(g: Garment): Slot | null {
  const key = g.category === "other" ? "accessory" : g.category;
  return SLOTS[key] ?? null;
}

// Hairline croquis of a 5′8 regular man — about 7.3 heads, no face.
function Croquis() {
  return (
    <svg
      viewBox="0 0 300 500"
      className="absolute inset-0 h-full w-full text-ink"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      aria-hidden
    >
      {/* head */}
      <ellipse cx="150" cy="62" rx="17" ry="24" opacity="0.45" />
      {/* neck */}
      <path d="M141 84 L141 100 M159 84 L159 100" opacity="0.45" />
      {/* shoulders */}
      <path d="M141 100 L110 112 M159 100 L190 112" opacity="0.45" />
      {/* arms */}
      <path
        d="M110 112 L106 214 M106 214 L112 220 M118 120 L116 206"
        opacity="0.45"
      />
      <path
        d="M190 112 L194 214 M194 214 L188 220 M182 120 L184 206"
        opacity="0.45"
      />
      {/* torso + waist */}
      <path d="M118 120 L114 248 M182 120 L186 248" opacity="0.45" />
      <path d="M114 248 L186 248" opacity="0.3" />
      {/* hips */}
      <path d="M114 248 L112 264 M186 248 L188 264" opacity="0.45" />
      {/* legs */}
      <path d="M112 264 L120 444 M188 264 L180 444" opacity="0.45" />
      <path d="M150 288 L134 444 M150 288 L166 444" opacity="0.45" />
      {/* feet */}
      <path d="M120 444 L120 456 L138 456 L134 444" opacity="0.45" />
      <path d="M180 444 L180 456 L162 456 L166 444" opacity="0.45" />
    </svg>
  );
}

function HeightTicks() {
  const tick = "block h-px w-2 bg-hairline-strong";
  return (
    <div className="absolute inset-y-0 left-0 flex flex-col justify-between py-2 text-ink-soft">
      <div className="flex items-center gap-1.5">
        <span className={tick} />
        <span className="micro">5′8</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={tick} />
        <span className="micro">reg</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={tick} />
        <span className="micro">0</span>
      </div>
    </div>
  );
}

export function FitBoard({
  pieces,
  className,
}: {
  pieces: Garment[];
  className?: string;
}) {
  const slots = new Map<Slot, Garment[]>();
  for (const g of pieces) {
    const slot = slotOf(g);
    if (!slot) continue;
    const list = slots.get(slot) ?? [];
    list.push(g);
    slots.set(slot, list);
  }

  return (
    <figure className={className}>
      <div className="relative aspect-[3/5] border border-hairline bg-paper-deep overflow-hidden">
        <Croquis />
        <HeightTicks />
        {[...slots.entries()].map(([slot, list]) => (
          <div
            key={slot.top + slot.left}
            className="absolute flex items-center justify-center"
            style={{
              zIndex: slot.z,
              left: slot.left,
              top: slot.top,
              width: slot.width,
              height: slot.height,
            }}
          >
            {list.map((g) => (
              <img
                key={g.id}
                src={g.cutoutSrc || g.imageSrc}
                alt={g.name}
                className="min-w-0 flex-1 h-full object-contain"
              />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="micro mt-2 text-ink-soft">
        Your photos · Fit 5′8
      </figcaption>
    </figure>
  );
}
