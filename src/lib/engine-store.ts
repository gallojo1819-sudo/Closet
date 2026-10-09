/**
 * Saved engine results across app opens. The engine reads this synchronously; the browser
 * fills it from IndexedDB before the first build (engine-cache.ts). Node and tests leave it unset.
 * Keys are content hashes, so a hit is the same answer a fresh build would give.
 */

/**
 * Used when no deploy commit is known: node tests (no import.meta.env) and local builds.
 * Bump when matrix / week code or any rule JSON they read changes and you test a local build.
 */
export const ENGINE_VERSION_FALLBACK = "2026-10-09.1";

/** The deploy commit when there is one, else the fallback. Old entries then never hit after a deploy. */
export function engineVersionFrom(commit: string | undefined): string {
  const sha = commit?.trim();
  return sha ? `git-${sha}` : ENGINE_VERSION_FALLBACK;
}

/** Vercel's VERCEL_GIT_COMMIT_SHA, injected at build by vite.config.ts. Undefined under node --test. */
export const ENGINE_VERSION = engineVersionFrom(import.meta.env?.VITE_ENGINE_COMMIT as string | undefined);

export type EngineStore = {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
};

let store: EngineStore | null = null;

export function setEngineStore(next: EngineStore | null): void {
  store = next;
}

export function engineStore(): EngineStore | null {
  return store;
}

/** 53-bit string hash (cyrb53). */
function hash53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Exact text of a value: keeps undefined vs missing, NaN, Infinity and key order apart (JSON does not). */
function serial(v: unknown): string {
  if (v === undefined) return "u";
  if (v === null) return "n";
  if (typeof v === "number") return `#${String(v)}`;
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "t" : "f";
  if (Array.isArray(v)) return `[${v.map(serial).join(",")}]`;
  if (v instanceof Map) return `M[${[...v.entries()].map(([k, x]) => `${serial(k)}:${serial(x)}`).join(",")}]`;
  if (typeof v === "object") {
    return `{${Object.keys(v as object)
      .map((k) => `${JSON.stringify(k)}:${serial((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return `?${String(v)}`;
}

/** "engine-cache:<kind>:<version>:<hash>". Every input is serialised whole; two seeds plus length make a collision moot. */
export function engineKey(kind: string, parts: unknown[], version = ENGINE_VERSION): string {
  const body = serial(parts);
  return `engine-cache:${kind}:${version}:${hash53(body, 1)}${hash53(body, 2)}.${body.length.toString(36)}`;
}

/** Saved rows worth loading: this engine version only, newest first, at most `keep`. */
export function liveRows<T extends { key: string; at: number }>(rows: T[], keep: number): T[] {
  return rows
    .filter((row) => row.key.startsWith("engine-cache:") && row.key.includes(`:${ENGINE_VERSION}:`))
    .sort((a, b) => b.at - a.at)
    .slice(0, keep);
}
