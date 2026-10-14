/* Diagnostic: which pairable jacket group stays un-led on weekday/fall, and what is open around it. */
import { isOuterPiece, rotationEligible, rowWays, SCREEN_CAP, twinGroups, visibleDetectors, weekRotationRow } from "../src/lib/detectors.ts";
import { leadPiece } from "../src/lib/look-collage.ts";
import { advanceRotation, emptyRotation, type Rotation } from "../src/lib/rotation.ts";
import type { Garment, Occasion } from "../src/lib/types.ts";
import { testCloset } from "../src/lib/__fixtures__/snapshot.ts";

const CLOSET: Garment[] = testCloset;
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
const TWINS = twinGroups(CLOSET);
const KEY = new Map(CLOSET.map((g) => [g.id, TWINS.key(g)]));
const occasion = (process.argv[2] ?? "weekday") as Occasion;
const SEASON = "fall" as const;
const TODAY = "2026-10-14";
const ids = (look: readonly Garment[]) => look.map((g) => g.id);
const closet = CLOSET.map((g) => g.id);
const eligible = rotationEligible(CLOSET, SEASON).map((g) => g.id);
let rotation: Rotation = emptyRotation();
let stuck = new Set<string>();
for (let n = 1; n <= 2; n += 1) {
  const week = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: 8, today: TODAY, stuck });
  stuck = new Set(week.unpairable.map((g) => g.id));
  rotation = advanceRotation(rotation, { page: week.looks.map(ids), closet, eligible, stuck, alike: KEY }).next;
  const ways = rowWays(visibleDetectors(CLOSET, { occasion, season: SEASON }), CLOSET, {
    occasion, season: SEASON, salt: n - 1, onScreen: week.looks.flatMap(ids), leadIds: week.leads, today: TODAY, rotation, stuck,
  });
  const rows = ways.map((way) => ({ title: way.title, looks: way.looks[occasion] ?? [] }));
  rotation = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck, alike: KEY }).next;
  const page = [...week.looks, ...rows.flatMap((r) => r.looks)];
  const counts = new Map<string, number>();
  for (const look of page) for (const g of look) counts.set(KEY.get(g.id)!, (counts.get(KEY.get(g.id)!) ?? 0) + 1);
  const ledInRows = new Set(rows.flatMap((row) => row.looks.map((look) => KEY.get(leadPiece(look)!.id)!)));
  const jackets = eligible.filter((id) => !stuck.has(id) && isOuterPiece(BY_ID.get(id)!));
  console.log(`page ${n}: week ${week.looks.length}, rows ${rows.map((r) => `${r.title}=${r.looks.length}`).join(" | ")}`);
  console.log(`  pairable jacket groups: ${new Set(jackets.map((id) => KEY.get(id)!)).size}; stuck jackets: ${CLOSET.filter((g) => stuck.has(g.id) && isOuterPiece(g)).map((g) => g.name).join(", ")}`);
  for (const id of jackets) {
    const key = KEY.get(id)!;
    const led = ledInRows.has(key);
    const n = counts.get(key) ?? 0;
    if (!led && n < SCREEN_CAP) console.log(`  OPEN: ${BY_ID.get(id)!.name} (${id}) on ${n} card(s), leads none`);
  }
  const open = (cat: string) => CLOSET.filter((g) => eligible.includes(g.id) && !stuck.has(g.id) && g.category === cat && (counts.get(KEY.get(g.id)!) ?? 0) < SCREEN_CAP).length;
  console.log(`  open under cap: tops ${open("top")}, bottoms ${open("bottom")}, shoes ${open("footwear")}`);
}
