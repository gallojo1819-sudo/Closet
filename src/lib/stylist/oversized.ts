/**
 * Oversized tops and the one oversized jacket. One flag: the slot decides whether
 * the piece is the top or the outer. An explicit `oversized` on the piece wins;
 * otherwise these ids are the seed when the field is missing.
 * brown chore g_8qqqzpwxuwti: regular (Joe, Nov 6)
 */

/** Short names for the assistant. No house names. The jacket is not in the top list. */
export const OVERSIZED_LABELS: Readonly<Record<string, string>> = {
  g_d1awqw83gd3c: "navy sweater",
  g_gp53xkrmem9b: "grey knit sweater",
  g_reesb6nbrmm4: "navy long-sleeve polo",
  g_o739106dt8ym: "cream fleece half-zip",
  g_k0mfejxiu5f8: "cream fleece pullover",
  g_ko7zz8iktplc: "grey long-sleeve polo",
  g_v7uvadckh79p: "light blue denim overshirt",
  g_vzqle7zdtpis: "blue and ivory diamond sweater",
  g_z8gvd1zvrcif: "brown knit zip sweater",
  g_xc4gr022xmvm: "cream cable cardigan",
  g_x4adkv9zu9yu: "navy corduroy jacket",
};

export const DEFAULT_OVERSIZED_IDS: ReadonlySet<string> = new Set([
  "g_d1awqw83gd3c", // navy sweater
  "g_gp53xkrmem9b", // grey knit sweater
  "g_reesb6nbrmm4", // navy long-sleeve polo
  "g_o739106dt8ym", // cream fleece half-zip
  "g_k0mfejxiu5f8", // cream fleece pullover
  "g_ko7zz8iktplc", // grey long-sleeve polo
  "g_v7uvadckh79p", // light blue denim overshirt
  "g_vzqle7zdtpis", // blue and ivory diamond sweater
  "g_z8gvd1zvrcif", // brown knit zip sweater
  "g_xc4gr022xmvm", // cream cable-knit cardigan
  "g_x4adkv9zu9yu", // navy corduroy jacket
]);

const OVERSIZED_JACKET = "g_x4adkv9zu9yu";

/** The tops an oversized jacket may cover. Derived from the default list. */
export const OVERSIZED_TOP_LABELS: readonly string[] = [...DEFAULT_OVERSIZED_IDS]
  .filter((id) => id !== OVERSIZED_JACKET)
  .map((id) => OVERSIZED_LABELS[id] ?? id);

export function oversizedOf(g: { id: string; oversized?: boolean }): boolean {
  return g.oversized ?? DEFAULT_OVERSIZED_IDS.has(g.id);
}
