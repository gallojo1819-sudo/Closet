/**
 * The read-only cut-out audit. The rows are the real test closet (engine-garments.json, the
 * Oct 13 export's active pieces) with the cover keys the export carries for them; the last
 * test runs on the Oct 14 export itself when it is on this machine (kept outside the repo).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  auditCutouts,
  DEFAULT_EXPORT_PATH,
  formatAudit,
  livePieces,
  storedRows,
  type StoredPiece,
} from "./cutout-audit.ts";
import type { Garment } from "./types.ts";

const SWEATER = "g_mqjsmpqgwwvm";

const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/engine-garments.json", import.meta.url), "utf8"),
) as Garment[];

/** The fixture is stripped of its cover keys (public repo); the export holds o.jpg and c.jpg. */
function withCovers(): StoredPiece[] {
  return fixture.map((g) => ({
    ...g,
    imageSrc: `sb:u/${g.id}/o.jpg`,
    cutoutSrc: `sb:u/${g.id}/c.jpg`,
    imageSource: "cutout" as const,
    matteQuality: "clean" as const,
  }));
}

describe("the export shapes", () => {
  it("reads the closet_meta rows, one row, or the garments array", () => {
    const rows = withCovers();
    assert.equal(storedRows([{ user_id: "u", garments: rows }]).length, rows.length);
    assert.equal(storedRows({ garments: rows }).length, rows.length);
    assert.equal(storedRows(rows).length, rows.length);
    assert.deepEqual(storedRows(null), []);
    assert.deepEqual(storedRows([{ user_id: "u" }]), []);
  });

  it("drops tombstones, demo and archived like the app", () => {
    const rows = withCovers();
    const [a, b, c] = rows;
    const mixed: StoredPiece[] = [
      { ...a!, tombstone: true },
      { ...b!, demo: true },
      { ...c!, archived: true },
      ...rows.slice(3),
    ];
    assert.equal(livePieces(mixed).length, rows.length - 3);
  });
});

describe("the cut-out audit", () => {
  it("every cut-out with no verdict needs a re-check, the sweater among them", () => {
    const rows = withCovers();
    const audit = auditCutouts([{ user_id: "u", garments: rows }]);
    assert.equal(audit.pieces, fixture.length);
    assert.equal(audit.withCutout, fixture.length);
    assert.equal(audit.neverChecked, fixture.length);
    assert.equal(audit.mixed, 0);
    assert.equal(audit.needs.length, fixture.length);
    const sweater = audit.needs.find((r) => r.id === SWEATER);
    assert.ok(sweater, "the sweater is a real piece of the closet");
    assert.equal(sweater.reason, "never checked");
    assert.match(formatAudit("x.json", audit), new RegExp(`^  ${SWEATER}  needs re-check \\(never checked\\)  `, "m"));
    assert.match(formatAudit("x.json", audit), new RegExp(`^needs re-check: ${fixture.length}$`, "m"));
  });

  it("a yes verdict clears a piece; no and unclear keep it listed with the reason", () => {
    const at = "2026-10-16T12:00:00.000Z";
    const rows = withCovers().map((g) => {
      if (g.id === SWEATER) return { ...g, cutoutCheck: { one: "no" as const, why: "jacket sleeve", at } };
      if (g === undefined) return g;
      return g;
    });
    const [first, second] = rows;
    const checked = rows.map((g) => {
      if (g.id === first!.id && g.id !== SWEATER) return { ...g, cutoutCheck: { one: "yes" as const, why: "", at } };
      if (g.id === second!.id && g.id !== SWEATER) return { ...g, cutoutCheck: { one: "unclear" as const, why: "timeout", at } };
      return g;
    });
    const audit = auditCutouts(checked);
    assert.equal(audit.withCutout, fixture.length);
    assert.equal(audit.needs.length, fixture.length - 1);
    assert.equal(audit.mixed, 1);
    assert.equal(audit.unclear, 1);
    assert.equal(audit.neverChecked, fixture.length - 3);
    assert.equal(audit.needs.find((r) => r.id === SWEATER)?.reason, "verdict no");
    assert.equal(audit.needs.find((r) => r.id === second!.id)?.reason, "verdict unclear");
    assert.equal(audit.needs.some((r) => r.id === first!.id), false);
  });

  it("a refused plate or a phone cover is not a cut-out", () => {
    const rows = withCovers();
    const [a, b] = rows;
    const edited: StoredPiece[] = [
      { ...a!, cutoutSrc: "", reprint: true },
      { ...b!, cutoutSrc: b!.imageSrc, imageSource: "photo" },
      ...rows.slice(2),
    ];
    const audit = auditCutouts(edited);
    assert.equal(audit.pieces, fixture.length);
    assert.equal(audit.withCutout, fixture.length - 2);
    assert.equal(audit.needs.some((r) => r.id === a!.id || r.id === b!.id), false);
  });

  it("the Oct 14 export (outside the repo, read-only) lists the sweater as needs re-check", (t) => {
    if (!existsSync(DEFAULT_EXPORT_PATH)) {
      t.skip("export not on this machine");
      return;
    }
    const parsed: unknown = JSON.parse(readFileSync(DEFAULT_EXPORT_PATH, "utf8"));
    const audit = auditCutouts(parsed);
    assert.ok(audit.withCutout > 0);
    assert.equal(audit.neverChecked, audit.withCutout, "no cut-out had been checked before this round");
    const sweater = audit.needs.find((r) => r.id === SWEATER);
    assert.ok(sweater, "the sweater holds a cut-out that never went through the check");
    assert.equal(sweater.reason, "never checked");
  });
});
