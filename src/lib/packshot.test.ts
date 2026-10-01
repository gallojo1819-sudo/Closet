import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UNBRANDED_SUEDE_ID,
  attachCitation,
  coverPassAction,
  maySearchOfficial,
  officialCoverPatch,
  orderedPackshots,
  packshotAllowed,
  packshotCandidates,
  packshotFetchMiss,
  packshotPlan,
  packshotRank,
  responseText,
  visionRejects,
  type PackshotVerdict,
} from "./packshot.ts";

const reiss = {
  id: "g_1pg9y05mlkek",
  brand: "REISS",
  name: "Brown suede jacket",
  color: "brown",
  subtype: "field jacket",
  material: "suede",
  category: "outerwear",
  imageSrc: "sb:joe/g_1pg9y05mlkek/o.jpg",
  cutoutSrc: "sb:joe/g_1pg9y05mlkek/o.jpg",
  imageSource: "photo",
};

const doubleRl = {
  id: "g_qnmo5yzgl50b",
  brand: "Double RL Supply Company",
  name: "Navy field jacket",
  color: "navy",
  subtype: "field jacket",
  material: "cotton",
  category: "outerwear",
  imageSrc: "sb:joe/g_qnmo5yzgl50b/o.jpg",
  cutoutSrc: "sb:joe/g_qnmo5yzgl50b/c-photo.jpg",
  imageSource: "photo",
};

const otherSuede = {
  id: UNBRANDED_SUEDE_ID,
  brand: "",
  name: "Brown suede jacket",
  color: "brown",
  subtype: "field jacket",
  material: "suede",
  category: "outerwear",
  imageSrc: "idb:g_py2swfwot1ed:o",
  cutoutSrc: "idb:g_py2swfwot1ed:o",
  imageSource: "photo",
};

const match: PackshotVerdict = {
  same: true,
  color: "match",
  pockets: "match",
  closure: "match",
  collar: "match",
  model: false,
};

describe("official search queries", () => {
  it("asks REISS for the suede jacket, then the brand site", () => {
    const plan = packshotPlan(reiss);
    assert.deepEqual(plan?.queries, [
      "REISS brown suede jacket zip flap pockets",
      "site:reiss.com",
    ]);
    assert.equal(plan?.site, "reiss.com");
  });

  it("keeps Double RL as the brand and does not invent a shop", () => {
    const plan = packshotPlan(doubleRl);
    assert.deepEqual(plan?.queries, ['"Double RL" navy field jacket corduroy collar']);
    assert.equal(plan?.site, null);
    assert.equal(JSON.stringify(plan).toLowerCase().includes("unknown"), false);
    assert.equal(JSON.stringify(plan).includes("doublerl.com"), false);
  });

  it("does not search the unbranded brown suede or call it REISS", () => {
    assert.equal(packshotPlan(otherSuede), null);
    assert.equal(maySearchOfficial(otherSuede.id, ""), false);
    assert.equal(maySearchOfficial(otherSuede.id, "REISS"), false);
    assert.equal(packshotPlan({ ...otherSuede, brand: "REISS" }), null);
    assert.equal(maySearchOfficial(reiss.id, reiss.brand), true);
    assert.equal(maySearchOfficial(doubleRl.id, doubleRl.brand), true);
    assert.equal(packshotPlan({ ...otherSuede, id: "g_other", brand: "" }), null);
  });

  it("builds other brands from the stored words only", () => {
    const plan = packshotPlan({
      id: "g_other",
      brand: "Rhude",
      name: "Black bomber",
      color: "black",
      subtype: "bomber",
      material: "wool",
    });
    assert.deepEqual(plan, { queries: ["Rhude black wool bomber"], site: null });
    assert.equal(plan?.queries[0]?.includes("zip flap"), false);
    assert.equal(plan?.queries[0]?.includes("corduroy"), false);
  });
});

describe("packshot hosts", () => {
  it("prefers the brand plate, then the four shops, and drops banned hosts", () => {
    const cands = [
      { imageUrl: "https://cdn.midjourney.com/jacket.jpg", pageUrl: "", title: "" },
      { imageUrl: "https://i.pinimg.com/jacket.jpg", pageUrl: "", title: "" },
      { imageUrl: "https://www.pinterest.com/pin/1", pageUrl: "", title: "" },
      { imageUrl: "https://style.blogspot.com/jacket.jpg", pageUrl: "", title: "" },
      { imageUrl: "https://shop.example/blog/jacket.jpg", pageUrl: "", title: "" },
      { imageUrl: "https://random.example/jacket.jpg", pageUrl: "https://random.example/p", title: "Random" },
      { imageUrl: "https://www.endclothing.com/jacket.jpg", pageUrl: "", title: "End" },
      { imageUrl: "https://www.selfridges.com/jacket.jpg", pageUrl: "", title: "Selfridges" },
      { imageUrl: "https://n.nordstrommedia.com/jacket.jpg", pageUrl: "", title: "Nordstrom" },
      { imageUrl: "https://www.mrporter.com/jacket.jpg", pageUrl: "", title: "Mr Porter" },
      { imageUrl: "https://www.reiss.com/jacket.jpg", pageUrl: "https://www.reiss.com/p", title: "REISS" },
    ];
    assert.equal(packshotAllowed(cands[0]!.imageUrl), false);
    assert.equal(packshotAllowed(cands[1]!.imageUrl), false);
    assert.equal(packshotAllowed(cands[2]!.imageUrl), false);
    assert.equal(packshotAllowed(cands[3]!.imageUrl), false);
    assert.equal(packshotAllowed(cands[4]!.imageUrl), false);
    assert.equal(packshotRank("https://www.reiss.com/jacket.jpg", "REISS"), 0);
    assert.equal(packshotRank("https://www.mrporter.com/jacket.jpg", "REISS"), 1);
    const ordered = orderedPackshots(cands, "REISS").map((c) => c.title);
    assert.deepEqual(ordered, ["REISS", "Mr Porter", "Nordstrom", "Selfridges", "End", "Random"]);
  });

  it("does not treat a blog page as a packshot even when the image host is fine", () => {
    const ordered = orderedPackshots(
      [{ imageUrl: "https://cdn.example/jacket.jpg", pageUrl: "https://notes.medium.com/post", title: "Blog" }],
      "REISS",
    );
    assert.deepEqual(ordered, []);
  });
});

describe("vision verdict", () => {
  it("rejects a model, navy versus black, a zip versus buttons, and two unclear details", () => {
    assert.equal(visionRejects({ ...match, model: true }), true);
    assert.equal(visionRejects({ ...match, color: "different" }), true);
    assert.equal(visionRejects({ ...match, pockets: "different" }), true);
    assert.equal(visionRejects({ ...match, closure: "different" }), true);
    assert.equal(visionRejects({ ...match, collar: "different" }), true);
    assert.equal(visionRejects({ ...match, same: false }), true);
    assert.equal(visionRejects({ ...match, pockets: "unclear", collar: "unclear" }), true);
    assert.equal(visionRejects({ ...match, pockets: "unclear" }), false);
    assert.equal(visionRejects(null), true);
  });

  it("reads the search JSON and does not invent an image URL", () => {
    const text = responseText({
      output_text: 'Here.\n{"imageUrl":"https://www.reiss.com/jacket.jpg","pageUrl":"https://www.reiss.com/p","title":"Suede"}',
    });
    const cands = packshotCandidates(text);
    assert.equal(cands[0]?.imageUrl, "https://www.reiss.com/jacket.jpg");
    assert.equal(cands[0]?.pageUrl, "https://www.reiss.com/p");
    assert.deepEqual(packshotCandidates("No photograph."), []);
    const cited = attachCitation(
      [{ imageUrl: "https://www.reiss.com/jacket.jpg", pageUrl: "", title: "" }],
      ["https://www.reiss.com/p"],
    );
    assert.equal(cited[0]?.pageUrl, "https://www.reiss.com/p");
  });

  it("treats a 403 or an empty download as a miss", () => {
    assert.equal(packshotFetchMiss(403, 1000), true);
    assert.equal(packshotFetchMiss(200, 0), true);
    assert.equal(packshotFetchMiss(200, 40), false);
  });
});

describe("cover pass", () => {
  it("searches the two branded jackets, plates the unbranded suede, and leaves real plates", () => {
    const blazer = {
      id: "blazer",
      brand: "Drake's",
      name: "Navy blazer",
      category: "outerwear",
      imageSrc: "idb:blazer:o",
      cutoutSrc: "idb:blazer:c",
      imageSource: "official",
    };
    const toggle = {
      id: "toggle",
      brand: "The North Face",
      name: "White beige toggle jacket",
      category: "outerwear",
      imageSrc: "sb:u/toggle/o.jpg",
      cutoutSrc: "sb:u/toggle/c.jpg",
      imageSource: "cutout",
    };
    assert.equal(coverPassAction(reiss), "search");
    assert.equal(coverPassAction(doubleRl), "search");
    assert.equal(coverPassAction(otherSuede), "plate");
    assert.equal(coverPassAction(blazer), "skip");
    assert.equal(coverPassAction(toggle), "skip");
    assert.equal(coverPassAction({ ...reiss, reprint: false }), "skip");
  });

  it("writes the official cover without imageSrc or notes", () => {
    const patch = officialCoverPatch("idb:g_1pg9y05mlkek:c", "https://www.reiss.com/jacket");
    assert.equal("imageSrc" in patch, false);
    assert.equal("notes" in patch, false);
    assert.equal(patch.cutoutSrc, "idb:g_1pg9y05mlkek:c");
    assert.equal(patch.imageSource, "official");
    assert.equal(patch.reprint, false);
    assert.equal(patch.productUrl, "https://www.reiss.com/jacket");
    const noPage = officialCoverPatch("idb:g_qnmo5yzgl50b:c", "  ");
    assert.equal("productUrl" in noPage, false);
    assert.equal(noPage.imageSource, "official");
  });

  it("puts Find the real photo above Make a plate", () => {
    const detail = readFileSync(new URL("../components/closet/detail.tsx", import.meta.url), "utf8");
    const findAt = detail.indexOf("Find the real photo");
    const makeAt = detail.indexOf("Make a plate");
    assert.ok(findAt > 0);
    assert.ok(makeAt > findAt);
    const pass = readFileSync(new URL("./plate-pass.ts", import.meta.url), "utf8");
    assert.equal(pass.includes("sync.ts"), false);
    assert.match(pass, /findOfficialCover/);
    assert.equal(pass.includes("imageSrc:"), false);
    assert.equal(pass.includes("notes:"), false);
  });
});
