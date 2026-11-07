/**
 * The three-clock Lookbook and Today tally from the R9 investigation.
 * No weather, no network. Run with TZ=America/New_York.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { testCloset } from "../src/lib/__fixtures__/snapshot.ts";
import { pickDropIds } from "../src/lib/drop-pick.ts";
import { renderedSectionLooks, rowWays, visibleDetectors, weekRotationRow } from "../src/lib/detectors.ts";
import { emptyRotation } from "../src/lib/rotation.ts";
import { seasonFromWeather } from "../src/lib/season.ts";
import { countsAsOuter } from "../src/lib/stylist/jackets.ts";
import { ruleHits } from "../src/lib/stylist/legal.ts";
import type { Garment, Occasion, Season } from "../src/lib/types.ts";

const OCCASIONS = ["weekday", "out", "weekend", "travel", "comfy"] as const;
const CLOCKS = ["2026-11-06", "2026-11-04", "2027-03-15"] as const;
const closet = testCloset.filter((g) => !g.archived);

function seasonOf(iso: string): Season {
  const [y, m, d] = iso.split("-").map(Number);
  return seasonFromWeather(undefined, new Date(y!, m! - 1, d!, 12, 0, 0));
}

function jacketId(look: Garment[]): string | null {
  const outer = look.find((g) => countsAsOuter(g));
  return outer?.id ?? null;
}

function tally(iso: string) {
  const season = seasonOf(iso);
  const today = pickDropIds(
    { garments: closet, journal: [], drop: null },
    { daily: { season, conditions: null }, today: iso },
  );
  const todayPieces = today.ids.map((id) => closet.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
  const todayHits = ruleHits(todayPieces, { occasion: "weekday", season, pool: closet });
  let cards = 0;
  let jacketed = 0;
  let bare = 0;
  let hard = 0;
  let form1 = 0;
  let form2 = 0;
  const byOccasion: Record<string, { jacket: number; bare: number }> = {};
  for (const occasion of OCCASIONS) {
    const week = weekRotationRow(closet, {
      occasion,
      season,
      salt: 0,
      today: iso,
      cap: 8,
      rotation: emptyRotation(),
    });
    const found = visibleDetectors(closet, { occasion, season, salt: 0, today: iso });
    const ways = rowWays(found, closet, {
      occasion,
      season,
      salt: 0,
      today: iso,
      rotation: emptyRotation(),
    });
    const section = renderedSectionLooks(ways, occasion);
    const weekLooks = week.looks.filter((look) => look.length >= 3);
    const looks = [
      ...weekLooks,
      ...section.map((card) => card.garmentIds.map((id) => closet.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g))),
    ];
    let jacket = 0;
    let none = 0;
    for (const look of looks) {
      cards += 1;
      if (jacketId(look)) {
        jacketed += 1;
        jacket += 1;
      } else {
        bare += 1;
        none += 1;
      }
      const hits = ruleHits(look, { occasion, season, pool: closet });
      if (hits.hard.length) hard += 1;
      if (hits.soft.includes("JKT-FORM-1")) form1 += 1;
      if (hits.soft.includes("JKT-FORM-2")) form2 += 1;
    }
    byOccasion[occasion] = { jacket, bare: none };
  }
  return {
    iso,
    season,
    cards,
    jacketed,
    bare,
    hard,
    form1,
    form2,
    byOccasion,
    today: {
      ids: today.ids,
      jacket: jacketId(todayPieces),
      hard: todayHits.hard,
      form: todayHits.soft.filter((id) => id === "JKT-FORM-1" || id === "JKT-FORM-2"),
    },
  };
}

const outDir = process.argv[2] ?? "/opt/cursor/artifacts/r9";
mkdirSync(outDir, { recursive: true });
const started = Date.now();
const rows = CLOCKS.map((iso) => {
  const row = tally(iso);
  console.log(JSON.stringify({ iso: row.iso, cards: row.cards, jacketed: row.jacketed, bare: row.bare, hard: row.hard, form1: row.form1, form2: row.form2 }));
  return row;
});
const report = {
  at: new Date().toISOString(),
  tz: process.env.TZ ?? "",
  fixture: closet.length,
  ms: Date.now() - started,
  rows,
};
writeFileSync(`${outDir}/clocks.json`, JSON.stringify(report, null, 2));
console.log("wrote", `${outDir}/clocks.json`, "in", report.ms, "ms");
