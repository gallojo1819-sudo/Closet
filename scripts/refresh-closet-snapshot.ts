/**
 * Refresh the test snapshot of the live closet (src/lib/__fixtures__/engine-garments.json)
 * from Supabase, or from an export of the closet_meta row kept outside the repo. READ-ONLY:
 * one select on closet_meta (none at all with --from-file), nothing else; no table or key in
 * closet.v6 / closet_meta is ever written, and the only file written is the fixture.
 *
 *   npm run snapshot:refresh          rewrite engine-garments.json from the account
 *   npm run snapshot:check            compare the live piece count with the snapshot, write nothing
 *   npx tsx scripts/refresh-closet-snapshot.ts [--check] [--from-file <path>]
 *
 * --from-file <path> reads the export instead of Supabase (no network, no env): a JSON file
 * holding the closet_meta rows (`[{ user_id, garments }]`), one row, or the garments array.
 * The export itself stays outside the repo; only the stripped pieces land in the fixture.
 *
 * Env (process.env only; nothing is printed or stored):
 *   url   VITE_SUPABASE_URL | SUPABASE_URL | NEXT_PUBLIC_SUPABASE_URL
 *   key   SUPABASE_SERVICE_ROLE_KEY | VITE_SUPABASE_ANON_KEY | SUPABASE_ANON_KEY | NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   closet_meta is RLS-scoped to the owner (closet_meta_select_own), so the anon key sees no
 *   row on its own: add the owner's access token (CLOSET_USER_TOKEN | SUPABASE_USER_TOKEN) as
 *   the caller, or use the service-role key with the owner's id (CLOSET_USER_ID |
 *   SUPABASE_USER_ID) when more than one closet row is visible.
 *
 * Both reads mirror the app: closet_meta.garments (rowToCloud in src/lib/cloud/commit.ts drops
 * tombstones, accountPool in cloud/merge.ts drops demo, livePool in rack.ts drops archived).
 * The repo is public, so the pieces are stripped the way the fixture already is: real opaque
 * ids (the house, jacket and colour rule JSON key on them), the stored name without the maker
 * (fixtureName: the brand phrase, house words and logo initials cut, so the pattern and colour
 * words the engine reads stay: "red gingham shirt", "blue pinstripe trousers"), empty brand,
 * notes and wear dates. createdAt is kept as stored: when a piece was added is no secret, and
 * the labels (src/lib/piece-label.ts) tell same-name pieces apart by it.
 *
 * The fixture is the whole test closet: every piece in it is in the account (the fifteen
 * hand-drafted `x_*` stand-ins that used to sit in redress-extra.json are gone).
 *
 * After a refresh, engine-snapshot.json (pinned engine outputs on the old pieces) must be
 * re-recorded from the base tree with src/lib/__fixtures__/record-engine-snapshot.ts.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CATEGORIES, type Category, type Garment, type Tuck } from "../src/lib/types.ts";

export const SNAPSHOT_URL = new URL("../src/lib/__fixtures__/engine-garments.json", import.meta.url);

export const URL_NAMES = ["VITE_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
export const KEY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;
export const TOKEN_NAMES = ["CLOSET_USER_TOKEN", "SUPABASE_USER_TOKEN"] as const;
export const USER_NAMES = ["CLOSET_USER_ID", "SUPABASE_USER_ID"] as const;

/** A stored piece with no readable createdAt gets this one (the app always stamps one; none in the export lacks it). */
export const FALLBACK_CREATED_AT = "2026-01-01T00:00:00.000Z";

/** The stored createdAt when it parses as a date, else the fallback. Kept verbatim: the labels read it. */
export function storedCreatedAt(createdAt: unknown): string {
  if (typeof createdAt !== "string" || !createdAt.trim()) return FALLBACK_CREATED_AT;
  return Number.isNaN(Date.parse(createdAt)) ? FALLBACK_CREATED_AT : createdAt;
}

type EnvMap = Record<string, string | undefined>;

export type SnapshotEnv =
  | { ok: true; url: string; key: string; urlName: string; keyName: string; token?: string; userId?: string }
  | { ok: false; message: string };

function pick(env: EnvMap, names: readonly string[]): { value: string; name: string } | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { value, name };
  }
  return null;
}

/** Only the names of the variables found are ever reported; the values stay in the process. */
export function readSnapshotEnv(env: EnvMap = process.env): SnapshotEnv {
  const url = pick(env, URL_NAMES);
  const key = pick(env, KEY_NAMES);
  if (!url || !key) {
    const missing = [!url ? `a Supabase url (${URL_NAMES.join(" | ")})` : "", !key ? `a key (${KEY_NAMES.join(" | ")})` : ""]
      .filter(Boolean)
      .join(" and ");
    return { ok: false, message: `No Supabase env: set ${missing}. Nothing was written.` };
  }
  const token = pick(env, TOKEN_NAMES);
  const userId = pick(env, USER_NAMES);
  return {
    ok: true,
    url: url.value,
    key: key.value,
    urlName: url.name,
    keyName: key.name,
    ...(token ? { token: token.value } : {}),
    ...(userId ? { userId: userId.value } : {}),
  };
}

/** What closet_meta.garments holds: closet.v6 garments plus tombstone stubs. */
export type StoredGarment = Partial<Garment> & { id: string; tombstone?: boolean };

/** The app's read of the stored array: rowToCloud, then accountPool, then livePool. */
export function liveGarments(stored: unknown): StoredGarment[] {
  if (!Array.isArray(stored)) return [];
  const rows = stored.filter(
    (g): g is StoredGarment => Boolean(g) && typeof g === "object" && typeof (g as { id?: unknown }).id === "string",
  );
  const live = rows.filter((g) => g.tombstone !== true);
  const account = live.filter((g) => g.demo !== true);
  const real = account.filter((g) => !g.archived);
  return real.length ? real : account.filter((g) => !g.archived);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Colour, material and subtype (or the category when the subtype is blank); the material is left out when the subtype already says it. */
export function builtName(colors: string[], material: string, subtype: string, category: string): string {
  const colour = (colors[0] ?? "").trim();
  const mat = material.trim();
  const sub = subtype.trim();
  const words = [colour];
  if (mat && !new RegExp(`\\b${escapeRegExp(mat)}\\b`, "i").test(sub)) words.push(mat);
  words.push(sub || category);
  return words.filter(Boolean).join(" ");
}

/** The app's placeholder for a piece not yet named (NEW_PIECE_NAME in src/lib/ingest.ts). */
const PLACEHOLDER = /^(new piece|untitled|unnamed)?$/;

/** Houses and makers' motifs a stored name may carry; the fixture carries none. Whole phrases. */
export const HOUSE_WORDS = [
  "polo bear",
  "ralph lauren",
  "ralph",
  "purple label",
  "double rl",
  "rrl",
  "aime leon dore",
  "aimé leon dore",
  "a.l.d.",
  "ald",
  "faloni",
  "sweet stable",
  "italian summer",
  "italian winter",
  "fortela",
  "drake's",
  "drakes",
  "fivefourfive",
] as const;

/** `text` with every whole-phrase occurrence of `phrase` cut (word boundaries on both sides). */
function withoutPhrase(text: string, phrase: string): string {
  const p = phrase.trim().toLowerCase();
  if (!p) return text;
  return text.replace(new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}(?![a-z0-9])`, "g"), "$1");
}

/**
 * The fixture name: the stored name, lower-cased, without the maker. The brand field's phrase,
 * every HOUSE_WORDS phrase and any one-letter word (a logo initial) are cut; what stays keeps
 * the pattern and colour words the engine reads ("red gingham shirt", "black white check shirt",
 * "blue pinstripe trousers"). A blank or placeholder name, or one that is nothing but the maker,
 * falls back to builtName (colour, material, subtype). Applying it again changes nothing.
 */
export function fixtureName(
  name: string,
  colors: string[],
  material: string,
  subtype: string,
  category: string,
  brand = "",
): string {
  let text = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (PLACEHOLDER.test(text)) return builtName(colors, material, subtype, category);
  for (const phrase of [brand, ...HOUSE_WORDS]) text = withoutPhrase(text, phrase);
  const words = text.split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w));
  return words.length ? words.join(" ") : builtName(colors, material, subtype, category);
}

const TUCKS: readonly Tuck[] = ["in", "out", "either"];
const FITS: readonly NonNullable<Garment["fit"]>[] = ["slim", "regular", "relaxed"];

function level(n: unknown, fallback: Garment["warmth"]): Garment["warmth"] {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n))) as Garment["warmth"];
}

/** The fixture row for a stored piece: the fields the engine reads, nothing personal. */
export function stripGarment(g: StoredGarment): Garment {
  const category: Category = (CATEGORIES as readonly string[]).includes(g.category ?? "") ? (g.category as Category) : "top";
  const colors = (Array.isArray(g.colors) ? g.colors : [])
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim())
    .filter(Boolean);
  const material = typeof g.material === "string" ? g.material.trim() : "";
  const subtype = typeof g.subtype === "string" ? g.subtype.trim() : "";
  const seasons = (Array.isArray(g.seasons) ? g.seasons : []).filter((s): s is string => typeof s === "string");
  const piece = {
    id: g.id,
    name: fixtureName(typeof g.name === "string" ? g.name : "", colors, material, subtype, category, typeof g.brand === "string" ? g.brand : ""),
    category,
    subtype,
    colors,
    material,
    brand: "",
    notes: "",
    formality: level(g.formality, 3),
    warmth: level(g.warmth, 3),
    seasons,
    demo: false,
    wornOn: [] as string[],
    archived: false,
    createdAt: storedCreatedAt(g.createdAt),
  };
  const fit = FITS.find((f) => f === g.fit);
  const tuck = TUCKS.find((t) => t === g.tuck);
  return { ...piece, ...(fit ? { fit } : {}), ...(tuck ? { tuck } : {}) } as Garment;
}

export function sortById<T extends { id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Same layout as the file today: one-space indent, newline at the end. */
export function fixtureText(pieces: Garment[]): string {
  return `${JSON.stringify(sortById(pieces), null, 1)}\n`;
}

export function readSnapshot(url: URL = SNAPSHOT_URL): Garment[] {
  return JSON.parse(readFileSync(url, "utf8")) as Garment[];
}

export type LiveCloset = {
  pieces: Garment[];
  stored: number;
  tombstones: number;
  demo: number;
  archived: number;
};

/** The stored array read the way the app does, each live piece stripped, plus what was left out. */
export function closetFromStored(stored: unknown): LiveCloset {
  const rows = Array.isArray(stored) ? stored : [];
  const typed = rows.filter((g): g is StoredGarment => Boolean(g) && typeof g === "object");
  return {
    pieces: liveGarments(stored).map(stripGarment),
    stored: typed.length,
    tombstones: typed.filter((g) => g.tombstone === true).length,
    demo: typed.filter((g) => g.tombstone !== true && g.demo === true).length,
    archived: typed.filter((g) => g.tombstone !== true && g.demo !== true && g.archived === true).length,
  };
}

/**
 * The garments array inside an export: a list of closet_meta rows, one row, or the array
 * itself. Throws when there is not exactly one closet row.
 */
export function exportGarments(parsed: unknown): unknown[] {
  const isRow = (x: unknown): x is { garments: unknown } =>
    Boolean(x) && typeof x === "object" && !Array.isArray(x) && "garments" in (x as object);
  if (isRow(parsed)) return Array.isArray(parsed.garments) ? parsed.garments : [];
  if (!Array.isArray(parsed)) throw new Error("The export is neither a closet_meta row list nor a garments array.");
  if (parsed.length && parsed.every(isRow)) {
    if (parsed.length > 1) throw new Error(`${parsed.length} closet rows are in the export; keep the owner's row only.`);
    return Array.isArray(parsed[0]!.garments) ? parsed[0]!.garments : [];
  }
  return parsed;
}

/** The export file read and reduced like the live row. No network; nothing but the path is reported. */
export function readExportCloset(path: string): LiveCloset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (e) {
    throw new Error(`Could not read the export at ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return closetFromStored(exportGarments(parsed));
}

/** One select on closet_meta, as the caller the env describes. Throws with a plain message; never echoes env. */
export async function fetchLiveCloset(env: Extract<SnapshotEnv, { ok: true }>): Promise<LiveCloset> {
  const sb = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(env.token ? { global: { headers: { Authorization: `Bearer ${env.token}` } } } : {}),
  });
  let query = sb.from("closet_meta").select("garments");
  if (env.userId) query = query.eq("user_id", env.userId);
  const { data, error } = await query;
  if (error) throw new Error(`closet_meta select failed: ${error.message}`);
  const rows = (data ?? []) as { garments?: unknown }[];
  if (rows.length === 0) {
    throw new Error(
      "No closet row is visible. closet_meta is RLS-scoped to the owner: pass the owner's access token " +
        `(${TOKEN_NAMES.join(" | ")}) with the anon key, or the service-role key with ${USER_NAMES.join(" | ")}.`,
    );
  }
  if (rows.length > 1) {
    throw new Error(`${rows.length} closet rows are visible; set ${USER_NAMES.join(" | ")} to pick the owner's.`);
  }
  return closetFromStored(Array.isArray(rows[0]?.garments) ? rows[0]!.garments : []);
}

function usage(): string {
  return [
    "usage: refresh-closet-snapshot.ts [--check] [--from-file <path>]",
    "  --check             compare the live piece count with the snapshot and write nothing",
    "  --from-file <path>  read an export of the closet_meta row (kept outside the repo) instead of Supabase",
  ].join("\n");
}

export type Args = { check: boolean; fromFile?: string };

/** The flags, or a message for the usage error. */
export function parseArgs(argv: string[]): Args | { error: string } {
  const args: Args = { check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag === "--check") args.check = true;
    else if (flag === "--from-file") {
      const path = argv[i + 1];
      if (!path || path.startsWith("--")) return { error: "--from-file needs a path" };
      args.fromFile = path;
      i += 1;
    } else return { error: `unknown argument ${flag}` };
  }
  return args;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  const args = parseArgs(argv);
  if ("error" in args) {
    console.error(`${args.error}\n${usage()}`);
    return 2;
  }
  const check = args.check;

  const snapshot = readSnapshot();
  let live: LiveCloset;
  try {
    if (args.fromFile) {
      console.log(`reading the export at ${args.fromFile} (no network)`);
      live = readExportCloset(args.fromFile);
    } else {
      const env = readSnapshotEnv();
      if (!env.ok) {
        console.error(env.message);
        return 2;
      }
      const role = env.keyName === "SUPABASE_SERVICE_ROLE_KEY" ? "service role" : "anon";
      const as = env.token ? "as the token's user" : env.userId ? "filtered to the given user id" : "as the key alone";
      console.log(`reading closet_meta with ${env.urlName} + ${env.keyName} (${role}), ${as}`);
      live = await fetchLiveCloset(env);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Nothing was written.");
    return 1;
  }
  console.log(
    `live: ${live.pieces.length} pieces (${live.stored} stored rows: ${live.tombstones} tombstones, ${live.demo} demo, ${live.archived} archived)`,
  );
  console.log(`snapshot: ${snapshot.length} pieces in engine-garments.json`);

  const snapIds = new Set(snapshot.map((g) => g.id));
  const liveIds = new Set(live.pieces.map((g) => g.id));
  const added = live.pieces.filter((g) => !snapIds.has(g.id)).map((g) => g.id);
  const removed = snapshot.filter((g) => !liveIds.has(g.id)).map((g) => g.id);

  if (check) {
    if (live.pieces.length !== snapshot.length) {
      console.error(`MISMATCH: live ${live.pieces.length} vs snapshot ${snapshot.length} (${added.length} new, ${removed.length} gone). Nothing was written.`);
      return 1;
    }
    console.log("OK: live count matches the snapshot. Nothing was written.");
    return 0;
  }

  const next = fixtureText(live.pieces);
  const current = readFileSync(SNAPSHOT_URL, "utf8");
  if (next === current) {
    console.log("engine-garments.json already matches the live closet; nothing to write.");
    return 0;
  }
  writeFileSync(SNAPSHOT_URL, next);
  console.log(`wrote engine-garments.json: ${live.pieces.length} pieces, ${added.length} new, ${removed.length} gone.`);
  if (added.length) console.log(`  new: ${added.join(", ")}`);
  if (removed.length) console.log(`  gone: ${removed.join(", ")}`);
  console.log(
    "engine-snapshot.json pins the engine on the old pieces: re-record it from the base tree (src/lib/__fixtures__/record-engine-snapshot.ts) and run the tests.",
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
