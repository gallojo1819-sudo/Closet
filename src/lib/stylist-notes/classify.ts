/**
 * The cheap classifier. One message in, one note or none out. No model call: a stated
 * preference or a correction has a cue word, and the thing it is about is a piece he
 * named, a category, a colour, a material, or a habit. A question, a skip, or a bare
 * "no" is not a note. Pure: node and vitest run it on the fixture closet.
 */
import { scoreNameMatch } from "../dress.ts";
import { livePool } from "../rack.ts";
import { scrubHouseNames } from "../stylist-page.ts";
import type { Garment } from "../types.ts";
import { NOTE_TEXT_MAX, type NoteInput, type NoteKind } from "./notes.ts";

/** A skip, a reroll, or a bare no: not his taste, never a note. */
export function isSkipMessage(text: string): boolean {
  const t = text.trim();
  if (/^(?:skip|next|pass|again|another|reroll|re-?dress)\b/i.test(t)) return true;
  return /^(?:no|nope|nah)\b[.!]?$/i.test(t);
}

type Cue = { kind: NoteKind; re: RegExp; correction?: boolean; objectBefore?: boolean };

/* Order matters only for ties at the same position; the earliest match in the text wins. */
const CUES: Cue[] = [
  { kind: "never", re: /\bnot (?:the|that|those|these|this|my)\b/i, correction: true },
  { kind: "never", re: /\bwithout (?:the|that|those|my)\b/i, correction: true },
  { kind: "never", re: /\b(?:lose|drop|ditch|swap|swap out|change|switch|replace) (?:the|that|those|my)\b/i, correction: true },
  {
    kind: "never",
    re: /\btoo (?:formal|dressy|loud|bright|warm|hot|heavy|cold|light|casual|sloppy|much|busy|preppy|boring|plain|dark|safe|matchy)\b/i,
    correction: true,
  },
  { kind: "never", re: /\bnever\b/i },
  { kind: "never", re: /\bno more\b/i },
  { kind: "never", re: /\bdon'?t (?:put me in|dress me in|use|give me|show me|like|want|wear|do|need|tuck|layer)\b/i },
  { kind: "never", re: /\bdo not (?:put me in|dress me in|use|give me|show me|like|want|wear|need|tuck|layer)\b/i },
  { kind: "never", re: /\bhate\b/i },
  { kind: "never", re: /\bcan'?t stand\b/i },
  { kind: "never", re: /\bnot a fan of\b/i },
  { kind: "never", re: /\bstop (?:with|using|showing|putting me in|suggesting)\b/i },
  { kind: "never", re: /\benough (?:of the|with the|of|with)\b/i },
  { kind: "lean", re: /\bi (?:prefer|like|love|favou?r|always wear|usually wear|want|live in|am into|'m into)\b/i },
  { kind: "lean", re: /\blean (?:into|toward|towards)\b/i },
  { kind: "lean", re: /\bmore (?:of the|of my|of)\b/i },
  { kind: "lean", re: /\bkeep (?:the|my|me in)\b/i },
  { kind: "lean", re: /\bmy (?:go-?to|favou?rite)\b/i },
  { kind: "lean", re: /\bgo with\b/i },
  { kind: "lean", re: /\b(?:is|are) (?:fine|ok|okay|good|back) (?:again|now)\b/i, objectBefore: true },
  { kind: "lean", re: /\b(?:you )?(?:can|could) (?:use|wear)\b/i },
];

const STOP = new Set([
  "the", "a", "an", "my", "me", "i", "in", "on", "to", "of", "it", "its", "them", "that", "those", "these", "this",
  "with", "and", "or", "but", "please", "again", "anymore", "any", "more", "is", "are", "be", "was", "were", "fine",
  "ok", "okay", "good", "back", "now", "ever", "really", "just", "so", "very", "much", "put", "wear", "wearing",
  "use", "using", "look", "looks", "thing", "things", "stuff", "all", "every", "some", "you", "your", "can", "could",
  "for", "at", "from", "up", "out", "into", "than", "then", "when", "like", "one", "ones", "pair", "pairs",
]);

const CATEGORY: Record<string, string> = {
  loafer: "loafers", loafers: "loafers", penny: "loafers",
  sneaker: "sneakers", sneakers: "sneakers", trainer: "sneakers", trainers: "sneakers", kicks: "sneakers",
  boot: "boots", boots: "boots", chelsea: "boots", chelseas: "boots", chukka: "boots", chukkas: "boots",
  mule: "mules", mules: "mules",
  shoe: "shoes", shoes: "shoes", footwear: "shoes",
  trouser: "trousers", trousers: "trousers", pant: "trousers", pants: "trousers", slacks: "trousers", gurkha: "trousers", gurkhas: "trousers",
  jean: "jeans", jeans: "jeans",
  chino: "chinos", chinos: "chinos",
  short: "shorts", shorts: "shorts",
  cord: "cords", cords: "cords", corduroys: "cords",
  hoodie: "hoodies", hoodies: "hoodies", hoody: "hoodies", sweatshirt: "hoodies", sweatshirts: "hoodies",
  polo: "polos", polos: "polos",
  tee: "tees", tees: "tees", "t-shirt": "tees", "t-shirts": "tees", tshirt: "tees", tshirts: "tees",
  shirt: "shirts", shirts: "shirts", oxford: "shirts", oxfords: "shirts", "button-down": "shirts", "button-downs": "shirts",
  "button-up": "shirts", "button-ups": "shirts", overshirt: "shirts", overshirts: "shirts", flannel: "shirts", flannels: "shirts",
  sweater: "knits", sweaters: "knits", knit: "knits", knits: "knits", jumper: "knits", jumpers: "knits", crewneck: "knits",
  crewnecks: "knits", pullover: "knits", pullovers: "knits", "half-zip": "knits", "quarter-zip": "knits", turtleneck: "knits",
  turtlenecks: "knits", merino: "knits",
  cardigan: "cardigans", cardigans: "cardigans",
  blazer: "blazers", blazers: "blazers", sportcoat: "blazers", sportcoats: "blazers",
  jacket: "jackets", jackets: "jackets", bomber: "jackets", bombers: "jackets", chore: "jackets",
  coat: "coats", coats: "coats", overcoat: "coats", overcoats: "coats", parka: "coats", parkas: "coats", topcoat: "coats",
  vest: "vests", vests: "vests", gilet: "vests",
  cap: "hats", caps: "hats", hat: "hats", hats: "hats", beanie: "hats", beanies: "hats",
  scarf: "scarves", scarves: "scarves",
  suit: "suits", suits: "suits",
  tie: "ties", ties: "ties",
  belt: "belts", belts: "belts",
  sunglasses: "sunglasses", shades: "sunglasses",
  bag: "bags", bags: "bags",
  sock: "socks", socks: "socks",
};

const STYLE: Record<string, string> = {
  tuck: "tuck", tucked: "tuck", tucking: "tuck", untucked: "tuck",
  layer: "layers", layers: "layers", layering: "layers", layered: "layers",
  formal: "formal", dressy: "formal", "dressed-up": "formal",
  casual: "casual", sloppy: "casual",
  loud: "loud", bright: "loud", flashy: "loud",
  print: "prints", prints: "prints", printed: "prints", pattern: "prints", patterns: "prints", stripe: "prints",
  stripes: "prints", striped: "prints", graphic: "prints", graphics: "prints", plaid: "prints", check: "prints",
  logo: "logos", logos: "logos", branding: "logos",
  baggy: "relaxed fit", relaxed: "relaxed fit", wide: "relaxed fit", oversized: "relaxed fit",
  slim: "slim fit", skinny: "slim fit", tight: "slim fit", fitted: "slim fit",
  tonal: "tonal", monochrome: "tonal",
  matchy: "matching", matching: "matching",
  warm: "warmth", hot: "warmth", heavy: "warmth", cold: "warmth",
  busy: "loud", plain: "plain", boring: "plain", safe: "plain", dark: "dark",
  preppy: "preppy",
};

const COLORS = new Set([
  "navy", "blue", "cream", "white", "ivory", "khaki", "beige", "tan", "camel", "brown", "chocolate", "olive", "green",
  "sage", "mint", "forest", "maroon", "burgundy", "oxblood", "wine", "pink", "blush", "mauve", "grey", "gray",
  "charcoal", "black", "rust", "gold", "yellow", "red", "orange", "purple", "indigo", "taupe", "silver",
]);

const MATERIALS = new Set([
  "suede", "leather", "linen", "wool", "cotton", "denim", "corduroy", "fleece", "cashmere", "silk", "polyester",
  "waxed", "nylon", "tweed", "velvet",
]);

function tokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9'’-]+/g, " ")
    .replace(/[’']/g, "")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w && !STOP.has(w));
}

function clause(text: string): string {
  return text.split(/[.,;!?]|\bbut\b|\band\b|\bbecause\b/i)[0] ?? "";
}

type Topic = { topic: string; pieceId?: string };

/** "light blue" stays one colour; "light" alone is not one. */
function colorOf(words: string[]): string {
  const at = words.findIndex((w) => COLORS.has(w));
  if (at < 0) return "";
  const color = words[at]!;
  return at > 0 && words[at - 1] === "light" ? `light ${color}` : color;
}

function phraseTopic(words: string[]): Topic | null {
  const color = colorOf(words);
  const material = words.find((w) => MATERIALS.has(w)) ?? "";
  const category = words.map((w) => CATEGORY[w]).find(Boolean) ?? "";
  const style = words.map((w) => STYLE[w]).find(Boolean) ?? "";
  if (category) {
    const bits = [color, material === "denim" && category === "jeans" ? "" : material, category];
    return { topic: bits.filter(Boolean).join(" ") };
  }
  if (style) return { topic: style };
  if (color) return { topic: color };
  if (material) return { topic: material };
  const left = words.filter((w) => w.length >= 3).slice(0, 2);
  return left.length ? { topic: left.join(" ") } : null;
}

function previousPiece(phrase: string, previous: Garment[]): Garment | null {
  let best: Garment | null = null;
  let score = 0;
  for (const g of previous) {
    const s = scoreNameMatch(phrase, g);
    if (s > score) {
      score = s;
      best = g;
    }
  }
  return score >= 3 ? best : null;
}

function scrubBrands(text: string, garments: Garment[]): string {
  let out = scrubHouseNames(text);
  const brands = new Set(garments.map((g) => (g.brand ?? "").trim()).filter((b) => b.length >= 3));
  for (const brand of brands) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The note a message makes, or null. `previousIds` are the pieces of the look the stylist
 * last showed: a correction cue about one of them becomes a note on that piece.
 */
export function classifyNote(
  text: string,
  garments: Garment[],
  opts: { previousIds?: readonly string[] } = {},
): NoteInput | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw || isSkipMessage(raw)) return null;
  if (raw.endsWith("?")) return null;
  let hit: { cue: Cue; at: number; end: number } | null = null;
  for (const cue of CUES) {
    const m = cue.re.exec(raw);
    if (!m) continue;
    if (!hit || m.index < hit.at) hit = { cue, at: m.index, end: m.index + m[0].length };
  }
  if (!hit) return null;
  const after = clause(raw.slice(hit.end));
  const before = raw.slice(0, hit.at).split(/[.,;!?]|\bbut\b|\band\b/i).pop() ?? "";
  const object = hit.cue.objectBefore ? before : after;
  let words = tokens(object);
  if (!words.length) words = tokens(hit.cue.objectBefore ? after : before);
  /* "too formal" carries its topic in the cue itself. */
  if (!words.length) words = tokens(raw.slice(hit.at, hit.end));
  const pool = livePool(garments);
  const previous = (opts.previousIds ?? [])
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  const correction = Boolean(hit.cue.correction) && previous.length > 0;
  let topic: Topic | null = null;
  if (correction) {
    const piece = previousPiece(object, previous);
    if (piece) topic = { topic: `piece:${piece.id}`, pieceId: piece.id };
  }
  /* "don't tuck my shirts" is about tucking, not about shirts: a habit in the cue wins. */
  const habit = tokens(raw.slice(hit.at, hit.end)).map((w) => STYLE[w]).find(Boolean);
  if (!topic && habit) topic = { topic: habit };
  if (!topic) topic = phraseTopic(words);
  if (!topic) return null;
  const clean = scrubBrands(raw, pool).slice(0, NOTE_TEXT_MAX);
  if (!clean) return null;
  return {
    text: clean,
    kind: hit.cue.kind,
    topic: topic.topic,
    source: correction ? "correction" : "stated",
  };
}

/** The piece a piece-topic points at, or null for a phrase topic. */
export function topicPieceId(topic: string): string | null {
  return topic.startsWith("piece:") ? topic.slice("piece:".length) : null;
}
