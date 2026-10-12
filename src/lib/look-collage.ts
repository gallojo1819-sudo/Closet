/**
 * "Rack, jacket first": where each piece of a look sits on its collage and what the card says
 * under it. Pure: relative imports only, no React, no DOM, so detectors.test.ts can load it from
 * a tmpdir next to the real detectors file.
 */
import { PALETTE, paletteCss } from "./color.ts";
import { slotOf } from "./style.ts";
import { wearSlot } from "./stylist/jackets.ts";
import type { Garment } from "./types.ts";

export type CollageSlot = "outer" | "top" | "top2" | "bottom" | "shoes" | "extra";

export type CollagePiece = { g: Garment; slot: CollageSlot; z: number };

/** Creative Director's stacking: the jacket is always above the top; the shoes sit above all. */
export const COLLAGE_Z: Record<CollageSlot, number> = {
  shoes: 5,
  outer: 4,
  top: 3,
  top2: 2,
  bottom: 1,
  extra: 0,
};

/**
 * Slot geometry as percentages of the lay (CD closet.html, verbatim). `top2` peeks out from
 * behind the top on the right. `tall` is the dress variant of the top slot.
 */
export const COLLAGE_GEOMETRY: Record<Exclude<CollageSlot, "extra"> | "tall" | "extra", { left: number; top: number; w: number }> = {
  outer: { left: 0, top: 0, w: 57 },
  top: { left: 43, top: 3.5, w: 51 },
  top2: { left: 50, top: 0, w: 44 },
  tall: { left: 43, top: 3.5, w: 51 },
  bottom: { left: 47, top: 43, w: 47 },
  shoes: { left: 5, top: 62, w: 35 },
  extra: { left: 66, top: 72, w: 28 },
};

function isOuter(g: Garment): boolean {
  return wearSlot(g) === "outer" || slotOf(g) === "outerwear";
}

function isMid(g: Garment): boolean {
  return !isOuter(g) && wearSlot(g) === "mid";
}

function isTopLike(g: Garment): boolean {
  if (isOuter(g)) return false;
  const slot = slotOf(g);
  return slot === "top" || slot === "dress" || wearSlot(g) === "mid" || wearSlot(g) === "top";
}

export function isDressPiece(g: Garment): boolean {
  return slotOf(g) === "dress" || g.category === "dress";
}

/**
 * Which slot each piece takes. The first outer is "outer"; the first top-like piece is "top"
 * (a mid layer over a shirt makes the shirt "top2"); the first bottom and shoe keep theirs.
 * Everything else is "extra". Order is stable: the pieces come back in the order given.
 */
export function collageSlots(pieces: Garment[]): CollagePiece[] {
  const taken = new Set<CollageSlot>();
  const assign: CollageSlot[] = pieces.map(() => "extra");
  const take = (i: number, slot: CollageSlot) => {
    if (taken.has(slot)) return false;
    taken.add(slot);
    assign[i] = slot;
    return true;
  };
  pieces.forEach((g, i) => {
    if (isOuter(g)) take(i, "outer");
  });
  // A mid layer (knit, half-zip, cardigan) is the top; the shirt under it peeks out as top2.
  const midAt = pieces.findIndex((g, i) => assign[i] === "extra" && isMid(g));
  if (midAt >= 0) take(midAt, "top");
  pieces.forEach((g, i) => {
    if (assign[i] !== "extra" || !isTopLike(g)) return;
    if (!taken.has("top")) take(i, "top");
    else if (!taken.has("top2") && !isDressPiece(g)) take(i, "top2");
  });
  pieces.forEach((g, i) => {
    if (assign[i] !== "extra") return;
    const slot = slotOf(g);
    if (slot === "bottom") take(i, "bottom");
    else if (slot === "footwear") take(i, "shoes");
  });
  return pieces.map((g, i) => ({ g, slot: assign[i]!, z: COLLAGE_Z[assign[i]!] }));
}

/**
 * Where a piece is drawn. With no outer, the top moves into the outer's geometry (the big
 * upper-left piece). A dress takes the top slot made taller. At most one "extra" is drawn,
 * small at the lower right; more than one are only listed in the caption.
 */
export function collageLayout(
  pieces: Garment[],
): (CollagePiece & { left: number; top: number; w: number; tall: boolean; drawn: boolean })[] {
  const slots = collageSlots(pieces);
  const hasOuter = slots.some((p) => p.slot === "outer");
  const extras = slots.filter((p) => p.slot === "extra").length;
  return slots.map((p) => {
    const dress = p.slot === "top" && isDressPiece(p.g);
    const key = p.slot === "top" && !hasOuter ? "outer" : dress ? "tall" : p.slot;
    const geo = COLLAGE_GEOMETRY[key];
    return { ...p, ...geo, tall: dress, drawn: p.slot !== "extra" || extras === 1 };
  });
}

const TINT_BASE = "#f4efe6";
export const TINT_FALLBACK = "#ece5d8";

/** Soft, deterministic tile tint from the piece's first colour: 18–24% of its swatch over paper. */
export function tileTint(g: Garment): string {
  const first = (g.colors ?? []).find((c) => c && c.trim());
  if (!first) return TINT_FALLBACK;
  const swatch = paletteCss(first);
  let h = 5;
  for (const ch of g.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pct = 18 + (h % 7);
  return `color-mix(in oklab, ${swatch} ${pct}%, ${TINT_BASE})`;
}

const COLOR_WORDS = new Set<string>([
  ...PALETTE.flatMap((c) => c.split(" ")),
  "light",
  "dark",
  "gray",
  "off-white",
  "off",
  "mid",
  "pale",
  "deep",
  "stone",
  "sand",
  "oatmeal",
  "ecru",
  "indigo",
  "blue",
  "green",
  "red",
  "orange",
  "yellow",
  "purple",
  "lavender",
  "sage",
  "taupe",
  "mocha",
  "espresso",
  "bone",
  "natural",
  "washed",
  "faded",
]);

/** The name without its brand and its colour words. "Cream half-zip" → "half-zip". */
export function plainName(g: Garment): string {
  let name = (g.name ?? "").trim();
  const brand = (g.brand ?? "").trim();
  if (brand) name = name.split(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig")).join(" ");
  const words = name
    .split(/\s+/)
    .filter((w) => w && !COLOR_WORDS.has(w.toLowerCase().replace(/[(),.]/g, "")));
  return words.join(" ").replace(/\s+/g, " ").trim();
}

function capFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Short serif title, CD style: "Half-zip and suede jacket". The top's plain name and the
 * outer's (the bottom's when there is no outer), lowercased after the first word. Names only,
 * never a brand or a label.
 */
export function lookTitle(pieces: Garment[]): string {
  const slots = collageSlots(pieces);
  const by = (slot: CollageSlot) => slots.find((p) => p.slot === slot)?.g;
  const lead = by("top") ?? by("top2") ?? by("bottom") ?? by("shoes") ?? pieces[0];
  const second = by("outer") ?? (lead === by("top") || lead === by("top2") ? by("bottom") : undefined) ?? by("shoes");
  const a = lead ? plainName(lead).toLowerCase() || lead.name.toLowerCase() : "";
  const b = second && second !== lead ? plainName(second).toLowerCase() || second.name.toLowerCase() : "";
  if (!a) return capFirst(b);
  if (!b || a === b) return capFirst(a);
  return capFirst(`${a} and ${b}`);
}

/** The piece names in collage order (outer, top, top2, bottom, shoes, extras), joined with " · ". */
export function pieceLine(pieces: Garment[]): string {
  const order: CollageSlot[] = ["outer", "top", "top2", "bottom", "shoes", "extra"];
  return collageSlots(pieces)
    .slice()
    .sort((x, y) => order.indexOf(x.slot) - order.indexOf(y.slot))
    .map((p) => p.g.name)
    .join(" · ");
}

type Kind = [RegExp, string];

/** The word that makes an outer layer itself. First match wins; the colour goes in front. */
const OUTER_KINDS: Kind[] = [
  [/field/, "field"],
  [/chore/, "chore"],
  [/trucker|denim jacket/, "trucker"],
  [/bomber/, "bomber"],
  [/sport\s?coat/, "sport coat"],
  [/blazer/, "blazer"],
  [/overshirt/, "overshirt"],
  [/cardigan/, "cardigan"],
  [/\bvest\b|gilet/, "vest"],
  [/fleece/, "fleece"],
  [/parka/, "parka"],
  [/overcoat|topcoat|long coat/, "topcoat"],
  [/\bcoat\b/, "coat"],
  [/shearling|sherpa/, "shearling"],
  [/suede/, "suede jacket"],
  [/leather/, "leather jacket"],
  [/waxed/, "waxed jacket"],
  [/cord/, "cord jacket"],
  [/wool/, "wool jacket"],
  [/quilted/, "quilted jacket"],
  [/jacket/, "jacket"],
];

const TOP_KINDS: Kind[] = [
  [/oxford|button-down|button down|\bocbd\b/, "oxford"],
  [/henley/, "henley"],
  [/rugby/, "rugby"],
  [/knit polo|merino polo|polo.*knit|knit.*polo/, "knit polo"],
  [/\bpolos?\b/, "polo"],
  [/turtleneck|roll neck|mock neck/, "turtleneck"],
  [/half-zip|half zip/, "half-zip"],
  [/quarter-zip|quarter zip/, "quarter-zip"],
  [/hoodie/, "hoodie"],
  [/sweatshirt|crewneck sweat/, "sweatshirt"],
  [/cardigan/, "cardigan"],
  [/flannel/, "flannel"],
  [/chambray/, "chambray"],
  [/\bcamp\b/, "camp collar"],
  [/linen/, "linen shirt"],
  [/denim/, "denim shirt"],
  [/\btee\b|t-shirt|t shirt/, "tee"],
  [/cable/, "cable knit"],
  [/sweater|knit|jumper|crew/, "knit"],
  [/dress shirt/, "dress shirt"],
  [/shirt|button-up/, "shirt"],
  [/dress/, "dress"],
  [/\bvest\b|gilet/, "vest"],
  [/fleece/, "fleece"],
  [/pullover/, "pullover"],
  [/overshirt/, "overshirt"],
  [/field/, "field"],
  [/jacket/, "jacket"],
];

/** Bottoms read by cloth: the colour goes in front except on denim. */
const BOTTOM_KINDS: Kind[] = [
  [/\bjeans?\b|denim|selvedge/, "denim"],
  [/\bcords?\b|corduroy/, "cords"],
  [/chino/, "chinos"],
  [/flannel/, "flannels"],
  [/gurkha/, "gurkhas"],
  [/pleat/, "pleats"],
  [/linen/, "linen"],
  [/track/, "track pants"],
  [/short/, "shorts"],
  [/jogger|sweatpant/, "sweats"],
  [/wool/, "wool trousers"],
  [/trouser/, "trousers"],
  [/pant/, "pants"],
];

const SHOE_KINDS: Kind[] = [
  [/sneaker|trainer/, "sneaker"],
  [/tassel/, "tassel loafer"],
  [/penny/, "penny loafer"],
  [/loafer/, "loafer"],
  [/chelsea/, "chelsea"],
  [/chukka/, "chukka"],
  [/\bboots?\b|roper/, "boot"],
  [/derby/, "derby"],
  [/brogue/, "brogue"],
  [/mule/, "mule"],
  [/moc|driver/, "moc"],
  [/sandal|slide/, "sandal"],
  [/oxford/, "oxford shoe"],
];

const DENIM_TONES = /white|black|ecru|cream|grey|gray/;

function kindText(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.material}`.toLowerCase();
}

function kindOf(g: Garment, table: Kind[], fallback: string): string {
  const text = kindText(g);
  for (const [re, kind] of table) if (re.test(text)) return kind;
  return fallback;
}

/** The first colour as one word: "navy/brown" → "navy". Empty when the piece has none. */
function tone(g: Garment): string {
  const first = (g.colors ?? []).find((c) => c && c.trim()) ?? "";
  return first.split("/")[0]!.trim().toLowerCase();
}

function toned(g: Garment, kind: string, withSuede = false): string {
  const parts: string[] = [];
  const colour = tone(g);
  if (colour && !kind.includes(colour)) parts.push(colour);
  if (withSuede && /suede/.test(kindText(g)) && !kind.includes("suede")) parts.push("suede");
  parts.push(kind);
  return parts.join(" ");
}

/**
 * The idea card's title names what makes the look different from the one beside it:
 * "Olive field, denim, white sneaker". The jacket (the top when there is none) with its
 * colour, the bottom by cloth, the shoe with its colour. Never "X and Y jacket", never a brand.
 */
export function ideaTitle(pieces: Garment[]): string {
  const slots = collageSlots(pieces);
  const by = (slot: CollageSlot) => slots.find((p) => p.slot === slot)?.g;
  const outer = by("outer");
  const top = by("top") ?? by("top2");
  const bottom = by("bottom");
  const shoes = by("shoes");
  const parts: string[] = [];
  if (outer) parts.push(toned(outer, kindOf(outer, OUTER_KINDS, "jacket"), true));
  else if (top) parts.push(toned(top, kindOf(top, TOP_KINDS, "top")));
  if (bottom) {
    const kind = kindOf(bottom, BOTTOM_KINDS, "trousers");
    const colour = tone(bottom);
    parts.push(kind === "denim" && !DENIM_TONES.test(colour) ? "denim" : toned(bottom, kind));
  }
  if (shoes) parts.push(toned(shoes, kindOf(shoes, SHOE_KINDS, "shoe"), true));
  if (!parts.length) {
    const first = pieces[0];
    return first ? capFirst(plainName(first).toLowerCase() || first.name.toLowerCase()) : "";
  }
  return capFirst(parts.join(", "));
}
