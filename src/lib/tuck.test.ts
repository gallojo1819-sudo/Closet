import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";
import { leadTop, lookTuckDecision } from "./look.ts";
import { slotOf } from "./style.ts";
import { guessTuck, isKnitTop, isShirtLike, resolveTuck, tuckMark, tuckOf } from "./tuck.ts";
import type { Garment } from "./types.ts";

function g(
  partial: Pick<Garment, "id" | "name" | "subtype"> & Partial<Garment>,
): Garment {
  return {
    category: "top",
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: [],
    imageSrc: "/x.jpg",
    cutoutSrc: "/x.jpg",
    imageSource: "official",
    matteQuality: "clean",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

describe("guessTuck", () => {
  it("oxford in, camp out, polo either", () => {
    assert.equal(
      guessTuck(g({ id: "1", name: "Navy oxford", subtype: "oxford" })),
      "in",
    );
    assert.equal(
      guessTuck(g({ id: "2", name: "Linen camp collar", subtype: "camp shirt" })),
      "out",
    );
    assert.equal(
      guessTuck(g({ id: "3", name: "Grey polo", subtype: "polo" })),
      "either",
    );
  });

  it("notes override name", () => {
    assert.equal(
      guessTuck(
        g({
          id: "1",
          name: "Navy oxford",
          subtype: "oxford",
          notes: "wear it untucked",
        }),
      ),
      "out",
    );
  });

  it("missing field uses the guess", () => {
    const ox = g({ id: "1", name: "White oxford", subtype: "oxford shirt" });
    assert.equal(tuckOf(ox), "in");
    assert.equal(tuckOf({ ...ox, tuck: "out" }), "out");
  });

  it("polo either is in for out under a blazer, out for weekend", () => {
    const polo = g({ id: "p", name: "Navy polo", subtype: "polo" });
    assert.equal(resolveTuck(polo, "out"), "out");
    assert.equal(
      resolveTuck(polo, "out", [
        polo,
        g({ id: "z", name: "Navy blazer", subtype: "blazer", category: "outerwear" }),
      ]),
      "in",
    );
    assert.equal(resolveTuck(polo, "weekend"), "out");
    const ox = g({ id: "o", name: "White oxford", subtype: "oxford" });
    assert.equal(resolveTuck(ox, "weekday"), "in");
    assert.equal(resolveTuck(ox, "weekend"), "out");
    assert.equal(resolveTuck({ ...ox, tuck: "in" }, "weekend"), "in");
    const camp = g({ id: "c", name: "Linen camp collar", subtype: "camp shirt" });
    assert.equal(resolveTuck(camp, "weekend"), "out");
  });
});

function pants(): Garment {
  return g({ id: "pants", name: "Charcoal trousers", subtype: "trousers", category: "bottom" });
}

describe("lookTuckDecision", () => {
  it("a shirt set to either follows the occasion", () => {
    const shirt = g({ id: "s", name: "Blue striped shirt", subtype: "shirt", tuck: "either" });
    const pieces = [shirt, pants()];
    assert.equal(lookTuckDecision(pieces, "weekend"), "out");
    assert.equal(lookTuckDecision(pieces, "weekday"), "in");
    assert.equal(tuckMark("out", shirt), "untucked");
    assert.equal(tuckMark("in", shirt), "tucked");
  });

  it("a saved tuck wins over the occasion", () => {
    const inn = g({ id: "s", name: "White oxford", subtype: "oxford", tuck: "in" });
    const out = g({ id: "s", name: "White oxford", subtype: "oxford", tuck: "out" });
    assert.equal(lookTuckDecision([inn, pants()], "weekend"), "in");
    assert.equal(lookTuckDecision([out, pants()], "weekday"), "out");
  });

  it("a never-tuck habit wears the lead out", () => {
    const shirt = g({ id: "s", name: "White oxford", subtype: "oxford", tuck: "either" });
    assert.equal(lookTuckDecision([shirt, pants()], "weekday", ["s"]), "out");
  });

  it("a knit sweater either is out on the weekend, and a saved out stays out", () => {
    const either = g({ id: "k", name: "Grey knit sweater", subtype: "sweater", tuck: "either" });
    const saved = g({
      id: "k",
      name: "Brown speckled knit sweater",
      subtype: "sweater",
      tuck: "out",
    });
    assert.equal(isKnitTop(either), true);
    assert.equal(lookTuckDecision([either, pants()], "weekend"), "out");
    assert.equal(lookTuckDecision([saved, pants()], "weekday"), "out");
  });

  it("a knit worn in has no tuck label", () => {
    const knit = g({
      id: "k",
      name: "Cream ribbed half-zip sweater",
      subtype: "half-zip sweater",
      tuck: "either",
    });
    assert.equal(lookTuckDecision([knit, pants()], "weekday"), "in");
    assert.equal(tuckMark("in", knit), null);
    assert.equal(tuckMark("out", knit), "untucked");
    assert.equal(tuckMark("in", g({ id: "s", name: "White oxford", subtype: "oxford" })), "tucked");
  });

  it("a knit over a shirt is the lead", () => {
    const shirt = g({ id: "s", name: "White oxford", subtype: "oxford shirt" });
    const knit = g({ id: "k", name: "Grey knit sweater", subtype: "sweater" });
    assert.equal(leadTop([shirt, knit, pants()])?.id, "k");
    assert.equal(isShirtLike(g({ id: "p", name: "Knit polo", subtype: "polo" })), true);
    assert.equal(isKnitTop(g({ id: "p", name: "Knit polo", subtype: "polo" })), false);
    assert.equal(isKnitTop(g({ id: "w", name: "Grey crew sweatshirt", subtype: "sweatshirt" })), false);
  });

  it("a hoodie alone, or a top with no bottom, is none", () => {
    const hoodie = g({ id: "h", name: "Grey hoodie", subtype: "hoodie" });
    const shirt = g({ id: "s", name: "White oxford", subtype: "oxford" });
    assert.equal(lookTuckDecision([hoodie, pants()], "weekend"), "none");
    assert.equal(lookTuckDecision([shirt], "weekend"), "none");
    assert.equal(tuckMark("none", shirt), null);
  });

  it("half-zips, quarter-zips and fleece sweatshirts are knits, and a sweatshirt is never labeled tucked", () => {
    const byId = new Map(liveSnapshot.map((g) => [g.id, g]));
    for (const id of ["g_1khiworawkt7", "g_j1n1vh1wvbo4", "g_dsqnx6ckt81v", "g_kp1ps7qww1ar"]) {
      const piece = byId.get(id);
      assert.ok(piece, id);
      assert.equal(isKnitTop(piece!), true, piece!.name);
    }
    const chinos = byId.get("g_xi3w7tz3aren");
    assert.ok(chinos);
    const knitish = /sweat|sweater|knit|zip|fleece|cardigan|pullover/;
    for (const top of liveSnapshot) {
      if (top.archived || slotOf(top) !== "top") continue;
      for (const occasion of ["weekday", "out"] as const) {
        const pieces = [top, chinos!];
        const lead = leadTop(pieces);
        const blob = lead ? `${lead.subtype} ${lead.name}`.toLowerCase() : "";
        if (!lead || !knitish.test(blob)) continue;
        assert.notEqual(
          tuckMark(lookTuckDecision(pieces, occasion), lead),
          "tucked",
          `${top.id} ${top.name} ${occasion}`,
        );
      }
    }
    const sweat = byId.get("g_6qz38nwsrupx");
    assert.ok(sweat);
    const worn = [sweat!, chinos!];
    assert.equal(tuckMark(lookTuckDecision(worn, "weekday"), leadTop(worn)), null);
  });
});
