/**
 * Attribute checks for the Lookbook outfit rules. A piece qualifies by its
 * name, subtype, material, colour and warmth. No stored id is read here.
 */
type Cloth = {
  name?: string;
  subtype?: string;
  material?: string;
  notes?: string;
  colors?: readonly string[];
  category?: string;
  warmth?: number;
};

function blob(g: Cloth): string {
  return `${g.subtype ?? ""} ${g.name ?? ""} ${g.material ?? ""} ${g.notes ?? ""}`.toLowerCase();
}

export function sportCoatPiece(g: Cloth): boolean {
  return /blazer|sport\s*coats?/.test(blob(g));
}

/** A casual outer that may sit over a blazer: field, chore, suede or shearling jacket, toggle, wool plaid. */
export function casualCover(g: Cloth): boolean {
  if (sportCoatPiece(g)) return false;
  const b = blob(g);
  if (/bomber|harrington|trucker|varsity|letterman|\bvests?\b|\bfleece\b/.test(b)) return false;
  if (/field/.test(b) && /jacket/.test(b)) return true;
  if (/\bchore\b/.test(b)) return true;
  if (/suede|shearling|sherpa/.test(b) && /jacket/.test(b)) return true;
  if (/toggle/.test(b)) return true;
  if (/plaid/.test(b) && /wool/.test(b) && /jacket/.test(b)) return true;
  return false;
}

export function cardiganPiece(g: Cloth): boolean {
  return /cardigan/.test(blob(g));
}

/** Crew, zip, quarter-zip, half-zip, cable or Fair Isle. Not a collared sweater, polo or hoodie. */
export function nonCollaredKnit(g: Cloth): boolean {
  const b = blob(g);
  if (/hoodie|\bpolos?\b|cardigan/.test(b)) return false;
  if (/collar/.test(b) && /sweater|knit/.test(b)) return false;
  const knit = /knit|sweater|cable|fair\s*isle|fairisle/.test(b);
  const shape = /crew|quarter[- ]?zip|half[- ]?zip|\bzip\b|\bcable\b|fair\s*isle|fairisle/.test(b);
  return knit && shape;
}

/** A collared woven shirt: shirt, button-up, button-down, dress shirt, oxford. Not a knit, polo, camp, bowling, graphic or hoodie. */
export function collaredShirt(g: Cloth): boolean {
  const b = blob(g);
  if (/hoodie|\bpolos?\b|sweater|\bknit\b|cardigan|\bcamp\b|bowling|graphic/.test(b)) return false;
  return /\bshirts?\b|button[- ]?ups?|button[- ]?downs?|dress shirt|oxford/.test(b);
}

export function flannelPiece(g: Cloth): boolean {
  return /flannel/.test(blob(g));
}

export function linenPiece(g: Cloth): boolean {
  return /linen/.test(`${blob(g)} ${(g.material ?? "").toLowerCase()}`);
}

/** A knit a tailor pass may put a blazer over: not cable, not chunky. */
export function fineKnitTop(g: Cloth): boolean {
  const b = blob(g);
  if (/hoodie|cable|chunky|aran|fisherman/.test(b)) return false;
  if (/fine knit|merino|cashmere/.test(b)) return true;
  return nonCollaredKnit(g) && !/cable|chunky/.test(b);
}

/**
 * A polo or tee at warmth 2 or under, or linen or camp, worn as the only top.
 * A knit polo at warmth 3 or more is not this.
 */
export function thinSoloTop(g: Cloth): boolean {
  const b = blob(g);
  if (/hoodie/.test(b)) return false;
  if (/\bpolos?\b/.test(b) && /knit|merino|cashmere/.test(b) && (g.warmth ?? 0) >= 3) return false;
  if ((/\bpolos?\b/.test(b) || /\btees?\b/.test(b) || /\bt-?shirts?\b/.test(b)) && (g.warmth ?? 0) <= 2) return true;
  if (/linen/.test(b) || /\bcamp\b/.test(b)) return true;
  return false;
}

export function sneakerPiece(g: Cloth): boolean {
  return /sneaker|trainer/.test(blob(g));
}

export function bootPiece(g: Cloth): boolean {
  const b = blob(g);
  return /\bboots?\b|chelsea|chukka/.test(b) && !sneakerPiece(g);
}

export function suedeShoe(g: Cloth): boolean {
  const b = blob(g);
  return /suede/.test(b) && (sneakerPiece(g) || /loafer|\bboots?\b|shoe/.test(b));
}

/** A leather (not suede) loafer. */
export function leatherLoafer(g: Cloth): boolean {
  const b = blob(g);
  return /loafer/.test(b) && !sneakerPiece(g) && !/suede/.test(b);
}

export function trouserBottom(g: Cloth): boolean {
  return /trouser|chino|\bjeans?\b|denim|cord/.test(blob(g));
}

export function loaferOrBoot(g: Cloth): boolean {
  const b = blob(g);
  return /loafer|\bboots?\b|chelsea|chukka/.test(b) && !sneakerPiece(g);
}

/** The high when one was measured, else the degree, else nothing. */
export function measuredHigh(weatherF?: number, highF?: number): number | undefined {
  if (typeof highF === "number" && Number.isFinite(highF)) return highF;
  if (typeof weatherF === "number" && Number.isFinite(weatherF)) return weatherF;
  return undefined;
}

/** Under 50°F measured, or winter when nothing was measured. */
export function coldLayer(season: string | undefined, weatherF?: number, highF?: number): boolean {
  const high = measuredHigh(weatherF, highF);
  if (typeof high === "number") return high < 50;
  return season === "winter";
}

/** Boot and sneaker weights: high at or under 45°F, or a wet day. */
export function shoeClimate(
  weatherF?: number,
  highF?: number,
  wet?: boolean,
): { cold: boolean; wet: boolean } {
  const high = measuredHigh(weatherF, highF);
  const rainy = wet === true;
  const cold = (typeof high === "number" && high <= 45) || rainy;
  return { cold, wet: rainy };
}

/** Partner weight for a shoe on a cold or wet day. 1 for everything else. */
export function shoeWeight(g: Cloth, climate: { cold: boolean; wet: boolean }): number {
  if (!climate.cold) return 1;
  let scale = 1;
  if (bootPiece(g)) scale *= 2;
  if (sneakerPiece(g)) scale *= 0.5;
  if (climate.wet && suedeShoe(g)) scale *= 0.5;
  return scale;
}
