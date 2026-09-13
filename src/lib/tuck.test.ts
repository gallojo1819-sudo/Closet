import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guessTuck, resolveTuck, tuckOf } from "./tuck.ts";
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
