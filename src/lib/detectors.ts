import type { Garment } from "./types.ts";

export type { CellContext, Way } from "./detectors/cells.ts";
export {
  cellGateOpen,
  cellLooks,
  detectorColor,
  detectorPalette,
  detectorTitle,
  maxDisjoint,
  nearestOpen,
  OCCASION_ORDER,
  sharedDetector,
  visibleDetectors,
  warmCellBook,
} from "./detectors/cells.ts";

type Detector = {
  id: string;
  title: string;
  top: (t: string) => boolean;
  bottom: (t: string) => boolean;
  shoe: (t: string) => boolean;
  clash: (pieces: Garment[]) => string | null;
};

export const DETECTOR_CAP = 4;

const BANNED_TITLE =
  /\b(Polo|Purple|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter)\b/;

function text(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.material} ${g.notes ?? ""} ${(g.colors ?? []).join(" ")}`.toLowerCase();
}

function has(pieces: Garment[], re: RegExp): boolean {
  return pieces.some((g) => re.test(text(g)));
}

const oxfordTop = (t: string) =>
  !/hoodie|sweatshirt|graphic/.test(t) && /oxford|button-down|button down|\bocbd\b|\bcable\b/.test(t);
const penny = (t: string) => /penny/.test(t) || (/loafer/.test(t) && !/suede|tassel|bit|woven/.test(t));
const suedeLoafer = (t: string) => /suede/.test(t) && /loafer/.test(t);
const graphicTop = (t: string) => /graphic tee|graphic t-shirt|graphic t shirt|\bhoodie\b|track jacket/.test(t);
const jean = (t: string) => /\bjeans?\b/.test(t) && !/jacket|shirt|overshirt|trucker/.test(t);
const pastel = (t: string) => /pastel|lavender|lilac|mint|peach|powder|baby blue|\bpink\b/.test(t);

const DETECTORS: Detector[] = [
  {
    id: "1",
    title: "Selvedge and western work",
    top: (t) => /western|pearl snap|snap shirt/.test(t),
    bottom: (t) => /selvedge|raw denim|rigid denim/.test(t),
    shoe: (t) => /roper/.test(t),
    clash: (pieces) =>
      has(pieces, /polo/) && has(pieces, /pink/) && has(pieces, /white/) && has(pieces, /sneaker/)
        ? "A pink polo with a white sneaker."
        : null,
  },
  {
    id: "2",
    title: "Oxford, chino, navy blazer",
    top: oxfordTop,
    bottom: (t) => /chino/.test(t),
    shoe: penny,
    clash: (pieces) =>
      (has(pieces, /hoodie/) || has(pieces, /graphic/)) && has(pieces, /blazer|sport coat|sportcoat/)
        ? "A graphic hoodie under a blazer."
        : null,
  },
  {
    id: "3",
    title: "Cords, gingham, boots",
    top: (t) => /gingham|fair\s*isle/.test(t),
    bottom: (t) => /\bcords?\b|corduroy/.test(t),
    shoe: (t) => /brown/.test(t) && /\bboots?\b/.test(t) && !/roper/.test(t),
    clash: (pieces) => (has(pieces, /\bcords?\b|corduroy/) && has(pieces, /linen/) ? "Cords with linen." : null),
  },
  {
    id: "4",
    title: "Glossy tailoring",
    top: (t) => /structured suit|dinner jacket|tuxedo|black tie/.test(t),
    bottom: (t) => /suit trouser|tuxedo trouser/.test(t),
    shoe: (t) => /calf|wholecut|cap-toe|cap toe/.test(t) && /oxford/.test(t),
    clash: (pieces) =>
      has(pieces, /suit trouser|tuxedo trouser/) && has(pieces, /sneaker/)
        ? "Suit trousers with a sneaker."
        : null,
  },
  {
    id: "5",
    title: "Shrunken grey suit",
    top: (t) => /short jacket|cropped jacket|shrunken jacket/.test(t),
    bottom: (t) => /cropped trouser|crop trouser|shrunken trouser/.test(t),
    shoe: (t) => /brogue/.test(t),
    clash: (pieces) =>
      has(pieces, /chunky|dad sneaker|platform sneaker/) || has(pieces, /overcoat|topcoat|long coat/)
        ? "A chunky sneaker or a long coat."
        : null,
  },
  {
    id: "6",
    title: "Fine knit and suede loafer",
    top: (t) => /fine knit|knit polo|merino polo/.test(t),
    bottom: (t) => /pleat/.test(t),
    shoe: suedeLoafer,
    clash: (pieces) =>
      has(pieces, /camp/) && has(pieces, /blazer|sport coat|sportcoat/) ? "A camp collar with a blazer." : null,
  },
  {
    id: "7",
    title: "Henley and relaxed denim",
    top: (t) => /henley|serafino|quarter[- ]?zip|zip knit/.test(t),
    bottom: (t) => /relaxed jean|loose jean|relaxed denim/.test(t),
    shoe: (t) => /loafer/.test(t) && !/suede|tassel|bit/.test(t),
    clash: (pieces) => (pieces.some((g) => pastel(text(g))) ? "Pastels." : null),
  },
  {
    id: "8",
    title: "Linen and a soft jacket",
    top: (t) => /linen|camp/.test(t),
    bottom: (t) => /gurkha|linen/.test(t),
    shoe: (t) => /loafer/.test(t) && !/\bboots?\b/.test(t),
    clash: (pieces) =>
      has(pieces, /linen/) && has(pieces, /flannel|\bcords?\b|corduroy|\bboots?\b/)
        ? "Linen with flannel, cords, or boots."
        : null,
  },
  {
    id: "9",
    title: "Flannel, cashmere, dark suede",
    top: (t) => /flannel|cashmere|merino/.test(t) && !/polo/.test(t),
    bottom: (t) => /flannel|wool trouser|cavalry twill/.test(t),
    shoe: (t) => /suede/.test(t) && /dark|black|brown|navy/.test(t) && !/sneaker/.test(t),
    clash: (pieces) => {
      if (has(pieces, /chunky|heavy cable|\bcable\b/) && has(pieces, /sport coat|blazer/)) {
        return "A chunky cable under a sport coat.";
      }
      if (has(pieces, /puffer/)) return "A puffer.";
      if (has(pieces, /gym|running shoe/)) return "A gym sneaker.";
      return null;
    },
  },
  {
    id: "10",
    title: "Clean city sportswear",
    top: (t) => /crewneck|crew neck|overshirt/.test(t) && !/graphic|hoodie/.test(t),
    bottom: (t) => /straight[- ]?leg|straight jean/.test(t),
    shoe: (t) => /clean sneaker|leather sneaker|minimal sneaker/.test(t) || penny(t),
    clash: (pieces) =>
      has(pieces, /western belt|trophy buckle/) && has(pieces, /roper/)
        ? "A western belt and a roper boot."
        : null,
  },
  {
    id: "11",
    title: "Boxy one-tone tailoring",
    top: (t) => /dropped shoulder|boxy jacket|boxy shirt/.test(t),
    bottom: (t) => /wide pleat|wide trouser/.test(t),
    shoe: (t) => /derby/.test(t),
    clash: (pieces) =>
      has(pieces, /athletic|running sneaker|\brunner\b/) && has(pieces, /pleat/)
        ? "An athletic sneaker under a pleat."
        : null,
  },
  {
    id: "12",
    title: "One print against plain",
    top: (t) => /jacquard|printed shirt|print shirt|paisley/.test(t),
    bottom: (t) => /chino|trouser|jean/.test(t) && !/print|jacquard|paisley/.test(t),
    shoe: (t) => /loafer|derby|sneaker/.test(t) && !/print|jacquard/.test(t),
    clash: (pieces) => {
      const printed = pieces.filter((g) => /print|jacquard|paisley/.test(text(g)));
      if (printed.length >= 2) return "Two prints.";
      if (printed.length === 1 && has(pieces, /graphic/)) return "A print plus a graphic.";
      return null;
    },
  },
  {
    id: "13",
    title: "Graphic tee and retro sneaker",
    top: graphicTop,
    bottom: jean,
    shoe: (t) => /retro sneaker|retro runner|vintage sneaker/.test(t),
    clash: (pieces) => {
      if (!has(pieces, /graphic|hoodie/)) return null;
      if (has(pieces, /sport coat|blazer/)) return "A graphic under a sport coat.";
      if (has(pieces, /cashmere/)) return "A graphic with cashmere.";
      return null;
    },
  },
  {
    id: "14",
    title: "Worn-in Paris casual",
    top: (t) => /washed tee|faded tee|washed t-shirt/.test(t) && !/graphic/.test(t),
    bottom: (t) => /faded black|washed black|black jean/.test(t),
    shoe: (t) => /suede boot/.test(t),
    clash: (pieces) =>
      has(pieces, /dress shirt/) && has(pieces, /\btie\b/) && has(pieces, /jean/)
        ? "A dress shirt and a tie with those jeans."
        : null,
  },
  {
    id: "15",
    title: "Soft outdoor",
    top: (t) => /fleece|quilt/.test(t),
    bottom: (t) => /relaxed trouser|hiking pant|nylon trouser/.test(t),
    shoe: (t) => /trail sneaker|trail runner|suede sneaker/.test(t),
    clash: (pieces) =>
      has(pieces, /fleece/) && has(pieces, /dress shirt|oxford|button-down/)
        ? "Fleece over a dress shirt."
        : null,
  },
];

export function detectorTitles(): string[] {
  return DETECTORS.map((d) => d.title);
}

export function titlesAreClothes(): boolean {
  return DETECTORS.length <= 15 && DETECTORS.every((d) => !BANNED_TITLE.test(d.title));
}

export function clashSentence(pieces: Garment[]): string | null {
  for (const d of DETECTORS) {
    const hit = d.clash(pieces);
    if (hit) return hit;
  }
  return null;
}


