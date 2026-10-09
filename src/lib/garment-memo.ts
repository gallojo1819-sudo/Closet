/**
 * Values derived from one garment object, built once and reused.
 * A value is reused only while every field a classifier reads is unchanged, so an
 * edited garment (or a different garment sharing an id) is never served an old answer.
 * Not for anything that reads wornOn, createdAt, archived, tuck or demo.
 */
import type { Garment } from "./types.ts";

type Memo = {
  /** New for every object and every change of its fields. */
  serial: number;
  id: string;
  category: string;
  subtype: string;
  name: string;
  notes: string;
  material: string;
  brand: string;
  fit: string | undefined;
  warmth: number;
  formality: number;
  colors: string[];
  colorList: string[];
  seasons: string[];
  seasonList: string[];
  vals: Map<string, unknown>;
};

const MEMO = new WeakMap<object, Memo>();
let serials = 0;

function sameList(a: string[], b: string[] | undefined): boolean {
  const list = b ?? [];
  if (a.length !== list.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== list[i]) return false;
  return true;
}

function memoOf(g: Garment): Memo {
  const m = MEMO.get(g);
  if (
    m &&
    m.id === g.id &&
    m.category === g.category &&
    m.subtype === g.subtype &&
    m.name === g.name &&
    m.notes === g.notes &&
    m.material === g.material &&
    m.brand === g.brand &&
    m.fit === g.fit &&
    m.warmth === g.warmth &&
    m.formality === g.formality &&
    m.colors === g.colors &&
    m.seasons === g.seasons &&
    sameList(m.colorList, g.colors) &&
    sameList(m.seasonList, g.seasons)
  ) {
    return m;
  }
  const next: Memo = {
    serial: ++serials,
    id: g.id,
    category: g.category,
    subtype: g.subtype,
    name: g.name,
    notes: g.notes,
    material: g.material,
    brand: g.brand,
    fit: g.fit,
    warmth: g.warmth,
    formality: g.formality,
    colors: g.colors,
    colorList: [...(g.colors ?? [])],
    seasons: g.seasons,
    seasonList: [...(g.seasons ?? [])],
    vals: new Map(),
  };
  MEMO.set(g, next);
  return next;
}

export function garmentMemo<T>(g: Garment, key: string, build: (g: Garment) => T): T {
  const vals = memoOf(g).vals;
  if (vals.has(key)) return vals.get(key) as T;
  const value = build(g);
  vals.set(key, value);
  return value;
}

type Node = { kids: Map<number, Node> | null; has: boolean; value: unknown };

const TUPLES = new Map<string, Node>();
const TUPLE_CAP = 200_000;
let tupleCount = 0;

/** Same idea for an ordered list of garments. Keyed by each piece's serial, so any field change misses. */
export function piecesMemo<T>(pieces: Garment[], key: string, build: (pieces: Garment[]) => T): T {
  let node: Node | undefined = TUPLES.get(key);
  if (!node) {
    node = { kids: null, has: false, value: undefined };
    TUPLES.set(key, node);
  }
  for (const g of pieces) {
    const serial = memoOf(g).serial;
    node.kids ??= new Map();
    let next: Node | undefined = node.kids.get(serial);
    if (!next) {
      next = { kids: null, has: false, value: undefined };
      node.kids.set(serial, next);
    }
    node = next;
  }
  if (node.has) return node.value as T;
  const value = build(pieces);
  if (++tupleCount > TUPLE_CAP) {
    TUPLES.clear();
    tupleCount = 0;
    return value;
  }
  node.has = true;
  node.value = value;
  return value;
}
