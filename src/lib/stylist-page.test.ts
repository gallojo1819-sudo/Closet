import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Garment } from "./types.ts";

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const {
  acceptStylistReply,
  answerAsked,
  formatStrongest,
  readStylistPage,
  screenSentence,
  stylistAskFields,
  writeStylistPage,
} = await import("./stylist-page.ts");
const { buildStylistSystem, emptyTaste } = await import("./taste.ts");

function piece(partial: Pick<Garment, "id" | "name" | "category"> & Partial<Garment>): Garment {
  return {
    subtype: "",
    colors: [],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 3,
    seasons: ["fall"],
    imageSrc: "/x.jpg",
    cutoutSrc: "/x.jpg",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-10-03",
    ...partial,
  } as Garment;
}

const blazer = piece({
  id: "g_blazer",
  name: "navy blazer",
  category: "outerwear",
  subtype: "blazer",
  colors: ["navy"],
});
const oxford = piece({
  id: "g_ox",
  name: "oxford",
  category: "top",
  subtype: "oxford",
  colors: ["white"],
});
const chinos = piece({
  id: "g_chino",
  name: "tan chinos",
  category: "bottom",
  subtype: "chinos",
  colors: ["tan"],
});
const loafers = piece({
  id: "g_loafer",
  name: "suede loafers",
  category: "footwear",
  subtype: "loafers",
  colors: ["tan"],
  material: "suede",
});
const owned = [blazer, oxford, chinos, loafers];

describe("stylist page", () => {
  it("lookbook context is the chips and the rendered look ids", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1", "l2"],
      screenLooks: [
        { id: "l1", garmentIds: ["g_ox", "g_chino", "g_loafer"] },
        { id: "l2", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafer"] },
        { id: "l_hidden", garmentIds: ["g_camel"] },
      ],
    });
    const fields = stylistAskFields({ prompt: "Which look?", garments: owned });
    assert.equal(fields.page.route, "lookbook");
    assert.equal(fields.page.occasion, "weekday");
    assert.equal(fields.page.season, "fall");
    assert.deepEqual(fields.page.onScreenLookIds, ["l1", "l2"]);
    assert.equal(fields.page.onScreenLookIds.includes("l_hidden"), false);
    assert.equal(fields.onScreenLooks?.some((look) => look.id === "l_hidden"), false);
    assert.equal(fields.onScreenLooks?.map((look) => look.id).join(), "l1,l2");
    const answer = answerAsked({
      prompt: "Which look is strongest?",
      page: fields.page,
      garments: owned,
      looks: fields.onScreenLooks,
    });
    assert.equal(answer.kind, "answer");
    if (answer.kind === "answer") {
      assert.equal(answer.text.includes("l_hidden"), false);
      assert.equal(answer.text.includes("g_camel"), false);
      assert.equal(answer.text.includes("camel"), false);
      assert.ok(answer.garmentIds.every((id) => owned.some((g) => g.id === id)));
      assert.equal(answer.garmentIds.includes("g_camel"), false);
    }
  });

  it("closet replaces the lookbook chips with the open piece", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      color: "navy",
      onScreenLookIds: ["l1"],
      weatherF: 62,
      screenLooks: [{ id: "l1", garmentIds: ["g_ox"] }],
    });
    writeStylistPage({ route: "closet", openGarmentId: "g_blazer", onScreenLookIds: [] });
    const page = readStylistPage();
    assert.equal(page.route, "closet");
    assert.equal(page.openGarmentId, "g_blazer");
    assert.equal(page.occasion, undefined);
    assert.equal(page.season, undefined);
    assert.equal(page.color, undefined);
    assert.equal(page.weatherF, undefined);
    assert.deepEqual(page.onScreenLookIds, []);
    const fields = stylistAskFields({ prompt: "What goes with this?", garments: owned, page });
    assert.equal(fields.page.route, "closet");
    assert.equal(fields.page.openGarmentId, "g_blazer");
    assert.equal("occasion" in fields.page, false);
    assert.equal("season" in fields.page, false);
    assert.equal("color" in fields.page, false);
    assert.equal(fields.onScreenLooks, undefined);
  });

  it("a missing weather reading is absent, not 68", () => {
    writeStylistPage({ route: "today", occasion: "weekday", onScreenLookIds: [] });
    const fields = stylistAskFields({ prompt: "What should I wear?", garments: owned });
    assert.equal(fields.weatherF, undefined);
    assert.equal("weatherF" in fields, false);
    assert.equal(fields.page.weatherF, undefined);
    assert.equal(JSON.stringify(fields).includes("68"), false);
    const system = buildStylistSystem({
      garments: owned,
      taste: emptyTaste(),
      occasion: "weekday",
    });
    assert.equal(system.includes("68"), false);
    const today = screenSentence(
      { route: "today", occasion: "weekday", season: "fall", onScreenLookIds: ["l1"] },
      owned,
      [{ id: "l1", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafer"] }],
    );
    assert.equal(today.includes("68"), false);
    assert.equal(today.includes("°"), false);
    const warm = formatStrongest(0, [blazer, oxford, chinos, loafers], {
      route: "today",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1"],
      weatherF: 62,
    });
    assert.match(warm ?? "", /at 62°/);
    const ai = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    assert.equal(ai.includes("?? 68"), false);
    assert.equal(dock.includes("?? 68"), false);
  });

  it("the panel is in the shell and /stylist opens that same panel", () => {
    const shell = readFileSync(new URL("../components/shell/app-shell.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../routes/stylist.tsx", import.meta.url), "utf8");
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const lookbook = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    const today = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    const add = readFileSync(new URL("../routes/add.tsx", import.meta.url), "utf8");
    const closet = readFileSync(new URL("../routes/closet.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("../components/closet/detail.tsx", import.meta.url), "utf8");
    assert.match(shell, /StylistDock/);
    assert.match(route, /StylistDock/);
    assert.match(dock, /data-stylist-dock/);
    assert.match(dock, /data-stylist-screen/);
    assert.match(dock, /messages\.map/);
    assert.match(lookbook, /writeStylistPage/);
    assert.match(lookbook, /onScreenLookIds/);
    assert.match(today, /writeStylistPage/);
    assert.match(add, /route: "add"/);
    assert.equal(closet.includes("writeStylistPage"), false);
    assert.match(detail, /bindClosetPiece/);
  });

  it("a reply that names a garment he does not own is rejected", () => {
    assert.equal(acceptStylistReply("Wear the camel overcoat.", owned), null);
    assert.equal(acceptStylistReply("The Polo blazer is the reason.", owned), null);
    assert.equal(acceptStylistReply("Anything goes with the oxford.", owned), null);
    const line = formatStrongest(1, [blazer, oxford, chinos, loafers], {
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1", "l2"],
    });
    assert.match(line ?? "", /The second look is the strongest/);
    assert.match(line ?? "", /navy blazer/);
    assert.match(line ?? "", /oxford/);
    assert.match(line ?? "", /tan chinos/);
    assert.match(line ?? "", /suede loafers/);
    assert.match(line ?? "", /Weekday and Fall/);
    assert.equal(/polo|ald|faloni|68|score/i.test(line ?? ""), false);
    assert.ok(acceptStylistReply(line ?? "", owned));
    const empty = screenSentence(
      { route: "lookbook", occasion: "weekday", season: "fall", onScreenLookIds: [] },
      owned,
    );
    assert.equal(empty, "Weekday and Fall are on. Nothing is on screen.");
    assert.equal(empty.includes("blazer"), false);
    const invented = answerAsked({
      prompt: "Wear the camel overcoat.",
      page: { route: "add", onScreenLookIds: [] },
      garments: owned,
    });
    assert.equal(invented.kind, "reject");
    const swap = answerAsked({
      prompt: "Swap the shirt",
      page: { route: "add", onScreenLookIds: [] },
      garments: owned,
    });
    assert.equal(swap.kind, "pass");
  });
});
