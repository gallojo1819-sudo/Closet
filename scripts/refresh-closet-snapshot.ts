/**
 * Refresh the test snapshot of the live closet (src/lib/__fixtures__/engine-garments.json)
 * from Supabase. READ-ONLY: one select on closet_meta, nothing else; no table or key in
 * closet.v6 / closet_meta is ever written.
 *
 *   npm run snapshot:refresh          rewrite engine-garments.json from the account
 *   npm run snapshot:check            compare the live piece count with the snapshot, write nothing
 *   npx tsx scripts/refresh-closet-snapshot.ts [--check]
 *
 * Env (process.env only; nothing is printed or stored):
 *   url   VITE_SUPABASE_URL | SUPABASE_URL | NEXT_PUBLIC_SUPABASE_URL
 *   key   SUPABASE_SERVICE_ROLE_KEY | VITE_SUPABASE_ANON_KEY | SUPABASE_ANON_KEY | NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   closet_meta is RLS-scoped to the owner (closet_meta_select_own), so the anon key sees no
 *   row on its own: add the owner's access token (CLOSET_USER_TOKEN | SUPABASE_USER_TOKEN) as
 *   the caller, or use the service-role key with the owner's id (CLOSET_USER_ID |
 *   SUPABASE_USER_ID) when more than one closet row is visible.
 *
 * The read mirrors the app: closet_meta.garments (rowToCloud in src/lib/cloud/commit.ts drops
 * tombstones, accountPool in cloud/merge.ts drops demo, livePool in rack.ts drops archived).
 * The repo is public, so the pieces are stripped the way the fixture already is: real opaque
 * ids (the house, jacket and colour rule JSON key on them), a name built from colour, material
 * and subtype, empty brand, notes and wear dates, a fixed createdAt.
 *
 * redress-extra.json is NOT refreshed: its fifteen `x_*` pieces are hand-drafted test pieces
 * that are not in the account.
 *
 * After a refresh, engine-snapshot.json (pinned engine outputs on the old pieces) must be
 * re-recorded from the base tree with src/lib/__fixtures__/record-engine-snapshot.ts.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CATEGORIES, type Category, type Garment, type Tuck } from "../src/lib/types.ts";

export const SNAPSHOT_URL = new URL("../src/lib/__fixtures__/engine-garments.json", import.meta.url);
export const EXTRA_URL = new URL("../src/lib/__fixtures__/redress-extra.json", import.meta.url);

export const URL_NAMES = ["VITE_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
export const KEY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;
export const TOKEN_NAMES = ["CLOSET_USER_TOKEN", "SUPABASE_USER_TOKEN"] as const;
export const USER_NAMES = ["CLOSET_USER_ID", "SUPABASE_USER_ID"] as const;

/** The pieces are stored with the same createdAt so the fixture carries no real dates. */
export const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";

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
export function fixtureName(colors: string[], material: string, subtype: string, category: string): string {
  const colour = (colors[0] ?? "").trim();
  const mat = material.trim();
  const sub = subtype.trim();
  const words = [colour];
  if (mat && !new RegExp(`\\b${escapeRegExp(mat)}\\b`, "i").test(sub)) words.push(mat);
  words.push(sub || category);
  return words.filter(Boolean).join(" ");
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
    name: fixtureName(colors, material, subtype, category),
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
    createdAt: FIXTURE_CREATED_AT,
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
  const stored = Array.isArray(rows[0]?.garments) ? (rows[0]!.garments as unknown[]) : [];
  const typed = stored.filter((g): g is StoredGarment => Boolean(g) && typeof g === "object");
  const live = liveGarments(stored);
  return {
    pieces: live.map(stripGarment),
    stored: typed.length,
    tombstones: typed.filter((g) => g.tombstone === true).length,
    demo: typed.filter((g) => g.tombstone !== true && g.demo === true).length,
    archived: typed.filter((g) => g.tombstone !== true && g.demo !== true && g.archived === true).length,
  };
}

function usage(): string {
  return "usage: refresh-closet-snapshot.ts [--check]\n  --check  compare the live piece count with the snapshot and write nothing";
}

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv);
  if (flags.has("--help") || flags.has("-h")) {
    console.log(usage());
    return 0;
  }
  for (const flag of flags) {
    if (flag !== "--check") {
      console.error(`unknown argument ${flag}\n${usage()}`);
      return 2;
    }
  }
  const check = flags.has("--check");
  const env = readSnapshotEnv();
  if (!env.ok) {
    console.error(env.message);
    return 2;
  }
  const role = env.keyName === "SUPABASE_SERVICE_ROLE_KEY" ? "service role" : "anon";
  const as = env.token ? "as the token's user" : env.userId ? "filtered to the given user id" : "as the key alone";
  console.log(`reading closet_meta with ${env.urlName} + ${env.keyName} (${role}), ${as}`);

  const snapshot = readSnapshot();
  const extras = readSnapshot(EXTRA_URL);
  let live: LiveCloset;
  try {
    live = await fetchLiveCloset(env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Nothing was written.");
    return 1;
  }
  console.log(
    `live: ${live.pieces.length} pieces (${live.stored} stored rows: ${live.tombstones} tombstones, ${live.demo} demo, ${live.archived} archived)`,
  );
  console.log(`snapshot: ${snapshot.length} pieces in engine-garments.json (+ ${extras.length} hand-drafted in redress-extra.json, not refreshed)`);

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
