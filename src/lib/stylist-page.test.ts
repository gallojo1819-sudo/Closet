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
  bindClosetPiece,
  formatStrongest,
  noteRoute,
  readStylistPage,
  replyFromStylistResult,
  screenSentence,
  stylistAskFields,
  stylistPayload,
  stylistProse,
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

  it("opening /stylist keeps the lookbook sentence and closet still drops it", () => {
    const looks = [{ id: "l1", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafer"] }];
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1"],
      screenLooks: looks,
    });
    const before = readStylistPage();
    const sentence = screenSentence(before, owned, looks);
    assert.notEqual(sentence, "Watching this page.");
    assert.match(sentence, /oxford|blazer|chinos|loafers/i);
    noteRoute("/stylist");
    const kept = readStylistPage();
    assert.equal(kept.route, "lookbook");
    assert.equal(kept.occasion, "weekday");
    assert.equal(kept.season, "fall");
    assert.deepEqual(kept.onScreenLookIds, ["l1"]);
    assert.equal(screenSentence(kept, owned, looks), sentence);
    noteRoute("/closet");
    const closet = readStylistPage();
    assert.equal(closet.route, "closet");
    assert.equal(closet.occasion, undefined);
    assert.equal(closet.season, undefined);
    assert.deepEqual(closet.onScreenLookIds, []);
    assert.equal(screenSentence(closet, owned), "Watching this page.");
  });

  it("an open polo is the sentence, not Watching this page", async () => {
    const polo = piece({
      id: "g_polo",
      name: "Cream long-sleeve polo",
      category: "top",
      subtype: "polo",
      colors: ["cream"],
      brand: "Polo",
    });
    const rack = [polo, oxford, chinos, loafers];
    writeStylistPage({ route: "closet", onScreenLookIds: [] });
    const release = bindClosetPiece(polo.id);
    const sentence = screenSentence(readStylistPage(), rack);
    assert.notEqual(sentence, "Watching this page.");
    assert.match(sentence, /Cream long-sleeve polo/);
    const asked = answerAsked({
      prompt: "What goes with this?",
      page: readStylistPage(),
      garments: rack,
    });
    assert.equal(asked.kind, "answer");
    if (asked.kind === "answer") assert.match(asked.text, /Cream long-sleeve polo/);
    release();
    await Promise.resolve();
  });

  it("a 200 reply is a line, and an unowned garment is the rejection", async () => {
    const ok = replyFromStylistResult(
      {
        ok: true,
        text: "The oxford with the tan chinos and the suede loafers.",
        garmentIds: ["g_ox", "g_chino", "g_loafer"],
      },
      owned,
    );
    assert.match(ok.text, /oxford/);
    assert.match(ok.text, /chinos/);
    assert.deepEqual(ok.garmentIds, ["g_ox", "g_chino", "g_loafer"]);
    assert.notEqual(stylistProse(ok.text).trim(), "");
    const denied = replyFromStylistResult(
      { ok: true, text: "Pair the Loro Piana cashmere sweater.", garmentIds: ["g_fake"] },
      owned,
    );
    assert.equal(denied.text, "That piece is not in this closet.");
    assert.deepEqual(denied.garmentIds, []);
    const asked = answerAsked({
      prompt: "Pair my Loro Piana cashmere sweater",
      page: { route: "add", onScreenLookIds: [] },
      garments: owned,
    });
    assert.equal(asked.kind, "reject");
    const named = replyFromStylistResult(
      { ok: true, text: "LOOK: g_ox,g_chino,g_loafer", garmentIds: ["g_ox", "g_chino", "g_loafer"] },
      owned,
    );
    assert.equal(named.text.includes("LOOK:"), false);
    assert.match(named.text, /oxford|chinos|loafers/i);
    const body = await stylistPayload({
      ok: true,
      json: async () => ({
        ok: true,
        text: "The oxford with the tan chinos and the suede loafers.",
        garmentIds: ["g_ox", "g_chino", "g_loafer"],
      }),
    });
    const painted = replyFromStylistResult(body, owned);
    assert.match(painted.text, /oxford/);
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    assert.match(dock, /replyFromStylistResult/);
    assert.match(dock, /stylistPayload/);
    assert.match(dock, /stylistProse/);
  });

  it("acceptance: /stylist keeps the lookbook context and its sentence", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      color: "navy",
      onScreenLookIds: ["l1", "l2"],
      screenLooks: [
        { id: "l1", garmentIds: ["g_ox", "g_chino", "g_loafers"] },
        { id: "l2", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafers"] },
      ],
    });
    const sentence = screenSentence(readStylistPage(), owned);
    assert.notEqual(sentence, "Watching this page.");
    noteRoute("/stylist");
    const kept = readStylistPage();
    assert.equal(kept.route, "lookbook");
    assert.equal(kept.occasion, "weekday");
    assert.equal(kept.season, "fall");
    assert.equal(kept.color, "navy");
    assert.deepEqual(kept.onScreenLookIds, ["l1", "l2"]);
    assert.equal(screenSentence(kept, owned), sentence);
  });

  it("acceptance: opening closet with no piece open drops the lookbook context", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1"],
      screenLooks: [{ id: "l1", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafers"] }],
    });
    noteRoute("/closet");
    const page = readStylistPage();
    assert.equal(page.route, "closet");
    assert.deepEqual(page.onScreenLookIds, []);
    assert.equal(page.openGarmentId, undefined);
    assert.equal(page.occasion, undefined);
    assert.equal(page.season, undefined);
    assert.equal(screenSentence(page, owned), "Watching this page.");
  });

  it("acceptance: an open piece is the sentence, never Watching this page", () => {
    // Zero look cards on Lookbook with chips set: the piece leads, not the chips.
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      openGarmentId: "g_blazer",
      onScreenLookIds: [],
      screenLooks: [],
    });
    const chips = screenSentence(readStylistPage(), owned);
    assert.notEqual(chips, "Watching this page.");
    assert.match(chips, /navy blazer/);
    assert.equal(chips.includes("Nothing is on screen."), false);
    // Looks on screen too: the piece still leads.
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      openGarmentId: "g_blazer",
      onScreenLookIds: ["l1"],
      screenLooks: [{ id: "l1", garmentIds: ["g_ox", "g_chino", "g_loafers"] }],
    });
    const withLooks = screenSentence(readStylistPage(), owned);
    assert.match(withLooks, /navy blazer/);
  });

  it("acceptance: the open piece survives the drawer unmount on the way to /stylist", async () => {
    writeStylistPage({ route: "closet", onScreenLookIds: [] });
    const release = bindClosetPiece(blazer.id);
    noteRoute("/stylist");
    assert.equal(readStylistPage().openGarmentId, blazer.id);
    release();
    await Promise.resolve();
    const kept = readStylistPage();
    assert.equal(kept.openGarmentId, blazer.id);
    assert.equal(kept.route, "closet");
    assert.notEqual(screenSentence(kept, owned), "Watching this page.");
    assert.match(screenSentence(kept, owned), /navy blazer/);
    // Closing the drawer while still on Closet clears it.
    const again = bindClosetPiece(blazer.id);
    noteRoute("/closet");
    again();
    await Promise.resolve();
    assert.equal(readStylistPage().openGarmentId, undefined);
    assert.equal(screenSentence(readStylistPage(), owned), "Watching this page.");
  });

  it("acceptance: a 200 naming an unowned garment paints the rejection line", async () => {
    const body = await stylistPayload({
      ok: true,
      json: async () => ({
        ok: true,
        text: "Pair the Loro Piana cashmere sweater.",
        garmentIds: ["g_fake"],
      }),
    });
    const painted = replyFromStylistResult(body, owned);
    assert.notEqual(painted.text.trim(), "");
    assert.equal(painted.text, "That piece is not in this closet.");
    assert.deepEqual(painted.garmentIds, []);
    const denied = await stylistPayload({ ok: false, error: "That piece is not in this closet." });
    const denial = replyFromStylistResult(denied, owned);
    assert.equal(denial.text, "That piece is not in this closet.");
    // The dock paints that text: it reads the body and pushes it to the thread.
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    assert.match(dock, /stylistPayload\(res\)/);
    assert.match(dock, /replyFromStylistResult\(payload, owned\)/);
    assert.match(dock, /text: painted\.text/);
    assert.match(dock, /NOT_IN_CLOSET/);
  });

  it("acceptance: screenLooks counts cards outside This week and never a hidden id", () => {
    const lookbook = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    // The page builds screenLooks from This week, the detector sections, and the hero cards.
    assert.match(lookbook, /for \(const look of realRow\) add\(/);
    assert.match(lookbook, /for \(const look of sectionLooks\) add\(/);
    assert.match(lookbook, /for \(const look of heroCards\) add\(/);
    // A section card (an id This week never renders) is ranked; a hidden id is not.
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1", "way:ivy:weekday:0:g_ox.g_chino.g_loafers"],
      screenLooks: [
        { id: "l1", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafers"] },
        { id: "way:ivy:weekday:0:g_ox.g_chino.g_loafers", garmentIds: ["g_ox", "g_chino", "g_loafers"] },
        { id: "l_hidden", garmentIds: ["g_blazer"] },
      ],
    });
    const fields = stylistAskFields({ prompt: "Which look is strongest?", garments: owned });
    assert.deepEqual(fields.page.onScreenLookIds, ["l1", "way:ivy:weekday:0:g_ox.g_chino.g_loafers"]);
    assert.equal(fields.onScreenLooks?.some((look) => look.id === "l_hidden"), false);
    const answer = answerAsked({ prompt: "Which look is strongest?", garments: owned });
    assert.equal(answer.kind, "answer");
    if (answer.kind === "answer") {
      assert.equal(answer.text.includes("l_hidden"), false);
      assert.equal(answer.garmentIds.includes("g_blazer"), false);
    }
  });
});
