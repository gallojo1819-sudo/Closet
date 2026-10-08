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
  answerTodayAsk,
  bindClosetPiece,
  isAdviceAsk,
  isTodayOutfitAsk,
  swapBaseIds,
  lookReply,
  looksLikeAtlasBlock,
  visibleReplyLines,
  wearSentence,
  briefLine,
  briefOccasion,
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
const { atlasText, buildStylistSystem, emptyTaste, swapDraft, swapSlot } = await import("./taste.ts");
const { dressThisPiece, resolvePiecesFromText } = await import("./dress.ts");

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
    assert.equal(shell.includes('startsWith("/stylist")'), false);
    assert.match(route, /openStylistPanel/);
    assert.match(dock, /data-stylist-dock/);
    assert.match(dock, /data-stylist-screen/);
    assert.match(dock, /replyLines/);
    assert.match(lookbook, /writeStylistPage/);
    assert.match(lookbook, /onScreenLookIds/);
    assert.match(today, /writeStylistPage/);
    assert.match(add, /route: "add"/);
    assert.equal(closet.includes("writeStylistPage"), false);
    assert.match(detail, /bindClosetPiece/);
  });

  it("replies a) lookReply is the one Wear sentence, never a block", () => {
    const field = piece({ id: "g_field", name: "Olive field jacket", category: "outerwear", subtype: "field jacket", colors: ["olive"] });
    const look = [oxford, chinos, loafers, field];
    const reply = lookReply(look);
    assert.equal(reply, wearSentence(look));
    assert.equal(reply, "Wear your oxford with the tan chinos and the suede loafers under the Olive field jacket.");
    assert.equal(reply!.includes("\n"), false);
    for (const bad of ["LOOK:", "g_", "out\n", "weekday\n"]) assert.equal(reply!.includes(bad), false, bad);
    assert.equal(/^(?:out|weekday|weekend|comfy|travel)\b/i.test(reply!), false);
    assert.equal(lookReply([oxford, loafers]), "Wear your oxford with the suede loafers.");
    assert.equal(lookReply([oxford]), "Wear your oxford.");
    assert.equal(lookReply([]), null);
  });

  it("replies b) a look built as an atlas block still replies as a sentence", () => {
    const pieces = [oxford, chinos, loafers, blazer];
    const block = `weekday\n${pieces.map((g) => g.name).join("\n")}\nLOOK: ${pieces.map((g) => g.id).join(",")}`;
    assert.equal(looksLikeAtlasBlock(block), true);
    assert.equal(looksLikeAtlasBlock("Wear your oxford with the tan chinos and the suede loafers."), false);
    assert.equal(looksLikeAtlasBlock("clean city — out\noxford"), true);
    const reply = lookReply(pieces)!;
    assert.equal(/^(?:out|weekday|weekend|comfy|travel)\b/i.test(reply), false, reply);
    assert.match(reply, /^Wear your /);
  });

  it("replies c) a brief word beats the today ask, and the today phrasings still hold", () => {
    for (const ask of [
      "what should I wear to dinner tonight",
      "what should I wear to the client meeting",
      "what should I wear this weekend",
      "what should I wear on Saturday",
    ]) {
      assert.equal(isTodayOutfitAsk(ask), false, ask);
    }
    for (const ask of ["What should I wear today?", "what do I wear", "what should i wear", "Outfit for today", "today's outfit", "What's today's look?"]) {
      assert.equal(isTodayOutfitAsk(ask), true, ask);
    }
  });

  it("replies d) the dinner ask is a brief for out", () => {
    assert.equal(briefOccasion("what should I wear to dinner tonight"), "out");
    assert.equal(briefOccasion("what should I wear to the client meeting"), "out");
    assert.equal(briefOccasion("What should I wear today?"), null);
  });

  it("replies e) the dock's look branches push one sentence, never a block", () => {
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const send = dock.slice(dock.indexOf("const send = async"), dock.indexOf("const wearDraft"));
    assert.ok(send.split("lookReply(pieces)").length - 1 >= 3, "dress, swap and server branches use lookReply");
    assert.equal(send.includes("stylistProse(line)"), false);
    assert.equal(send.includes("edited?.text"), false);
    assert.equal(send.includes("text: atlasText("), false);
    assert.equal(send.includes("atlasText({ technique, pieces"), false);
    assert.match(send, /looksLikeAtlasBlock\(painted\.text\)/);
  });

  it("replies f) the visible lines drop the occasion id and the LOOK row", () => {
    const block = "out\nBrown knit polo\nBeige trousers\nBrown leather tassel loafers\nOlive field jacket\nLOOK: g_a,g_b";
    const lines = visibleReplyLines(block);
    assert.deepEqual(lines, ["Brown knit polo", "Beige trousers", "Brown leather tassel loafers", "Olive field jacket"]);
    assert.deepEqual(visibleReplyLines("henley denim — weekend\nMISSING: shoes\nNavy henley"), ["Navy henley"]);
    assert.deepEqual(visibleReplyLines("Wear your oxford with the tan chinos and the suede loafers."), [
      "Wear your oxford with the tan chinos and the suede loafers.",
    ]);
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    assert.match(dock, /visibleReplyLines\(text\)/);
  });

  it("c) a line break ends a garment qualifier: the occasion never glues onto the piece", () => {
    const plaid = piece({ id: "g_plaid", name: "Grey plaid shirt", category: "top", subtype: "shirt", colors: ["grey"] });
    const rack = [...owned, plaid];
    assert.ok(acceptStylistReply("weekday\nGrey plaid shirt", rack));
    assert.ok(acceptStylistReply("weekend\nGrey plaid shirt\ntan chinos\nsuede loafers", rack));
    assert.equal(acceptStylistReply("weekday\nGrey plaid shirt", owned), null, "still rejected when unowned");
  });

  it("d) isTodayOutfitAsk is the whole-outfit ask about today", () => {
    for (const ask of [
      "What should I wear today?",
      "what do I wear",
      "what should i wear",
      "Outfit for today",
      "today's outfit",
      "What's today's look?",
    ]) {
      assert.equal(isTodayOutfitAsk(ask), true, ask);
    }
    for (const ask of ["what goes with my olive field jacket", "do I own a Loro Piana sweater", "swap the shoes", "what do I wear with the grey plaid shirt"]) {
      assert.equal(isTodayOutfitAsk(ask), false, ask);
    }
  });

  it("e) a today drop answers with exactly its pieces", () => {
    const drop = {
      date: "2026-10-08",
      garmentIds: ["g_ox", "g_chino", "g_loafer"],
      worn: false,
      verdict: "pending" as const,
      occasion: "weekday" as const,
    };
    const answer = answerTodayAsk({ drop, garments: owned, today: "2026-10-08" });
    assert.deepEqual(answer.garmentIds, drop.garmentIds);
    assert.equal(answer.occasion, "weekday");
    assert.match(answer.text, /^Wear your oxford with the tan chinos and the suede loafers\.$/);
    assert.equal(answer.text.includes("navy blazer"), false, "exactly the drop, no extra piece");
    for (const bad of ["That piece is not in this closet.", "LOOK:", "g_"]) assert.equal(answer.text.includes(bad), false, bad);
  });

  it("f) no drop or a stale drop still dresses him from the real rack", () => {
    const stale = {
      date: "2026-10-07",
      garmentIds: ["g_ox", "g_chino"],
      worn: false,
      verdict: "pending" as const,
      occasion: "out" as const,
    };
    for (const [label, drop] of [["no drop", null], ["yesterday", stale]] as const) {
      const answer = answerTodayAsk({ drop, garments: owned, today: "2026-10-08", weatherF: 55 });
      assert.ok(answer.garmentIds.length >= 3, `${label}: ${answer.garmentIds.length} pieces`);
      for (const id of answer.garmentIds) assert.ok(owned.some((g) => g.id === id), `${label}: ${id} not owned`);
      assert.match(answer.text, /^Wear your /, label);
      for (const bad of ["That piece is not in this closet.", "LOOK:", "g_"]) assert.equal(answer.text.includes(bad), false, `${label}: ${bad}`);
    }
  });

  it("g) the dock answers the today ask first and its catch is neutral", () => {
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const send = dock.slice(dock.indexOf("const send = async"), dock.indexOf("const wearDraft"));
    const todayAt = send.indexOf("isTodayOutfitAsk(q)");
    const askedAt = send.indexOf("answerAsked(");
    assert.ok(todayAt >= 0 && askedAt >= 0 && todayAt < askedAt, "today ask before answerAsked");
    const caught = send.slice(send.indexOf("} catch {"), send.indexOf("} finally {"));
    assert.equal(caught.includes("NOT_IN_CLOSET"), false, "the catch is neutral");
    assert.match(caught, /Couldn't answer\. Try again\./);
    assert.equal(send.includes("acceptStylistReply(line, owned) ?? NOT_IN_CLOSET"), false, "no raw block fallback");
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
    assert.match(lookbook, /for \(const look of weekRow\) add\(/);
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

  it("acceptance: the strongest-look answer is its own Wear sentence", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1"],
      screenLooks: [{ id: "l1", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafer"] }],
    });
    const answer = answerAsked({
      prompt: "What is the strongest look on this page?",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(answer.kind, "answer");
    if (answer.kind !== "answer") return;
    assert.ok(answer.text.startsWith("Wear your "));
    assert.notEqual(answer.text, screenSentence(readStylistPage(), owned));
    assert.match(answer.text, /oxford/);
    assert.match(answer.text, /tan chinos/);
    assert.match(answer.text, /suede loafers/);
    assert.match(answer.text, /under the navy blazer\.$/);
    assert.equal(answer.text.includes("LOOK:"), false);
    assert.equal(answer.text.includes("g_"), false);
    assert.equal(answer.text.includes("The first look is the strongest"), false);
    assert.deepEqual(answer.garmentIds, ["g_blazer", "g_ox", "g_chino", "g_loafer"]);
    // A winning look without a jacket wears plain. (Fall wants a layer; summer ranks bare.)
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "summer",
      onScreenLookIds: ["l2"],
      screenLooks: [{ id: "l2", garmentIds: ["g_ox", "g_chino", "g_loafer"] }],
    });
    const plain = answerAsked({
      prompt: "What is the strongest look on this page?",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(plain.kind, "answer");
    if (plain.kind === "answer") {
      assert.equal(plain.text, "Wear your oxford with the tan chinos and the suede loafers.");
    }
    // A question naming a garment he does not own stays a rejection.
    const denied = answerAsked({
      prompt: "Pair my Loro Piana cashmere sweater",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(denied.kind, "reject");
  });

  it("acceptance: a brief dresses him, the page does not answer it", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1"],
      screenLooks: [{ id: "l1", garmentIds: ["g_blazer", "g_ox", "g_chino", "g_loafer"] }],
    });
    // Looks are on screen; a brief still passes through to the dresser.
    const brief = answerAsked({
      prompt: "tuesday, boards meeting dinner",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(brief.kind, "pass");
    // The page question still answers from the on-screen looks.
    const pageAsk = answerAsked({
      prompt: "what is the strongest look on this page?",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(pageAsk.kind, "answer");
    if (pageAsk.kind === "answer") assert.match(pageAsk.text, /Wear your /);
    // Dinner outranks the day words; boards alone is out; a bare
    // weekday is weekday; the strongest-look question is not a brief.
    assert.equal(briefOccasion("tuesday, boards meeting dinner"), "out");
    assert.equal(briefOccasion("boards meeting tuesday"), "out");
    assert.equal(briefOccasion("tuesday"), "weekday");
    assert.equal(briefOccasion("what is the strongest look on this page?"), null);
    // The line leads with the boards, then the pieces he owns.
    const line = briefLine("tuesday, boards meeting dinner", [blazer, oxford, chinos, loafers]);
    assert.equal(
      line,
      "Boards, then dinner. Wear your oxford with the tan chinos and the suede loafers under the navy blazer.",
    );
    assert.equal(line?.includes("g_"), false);
    assert.equal(line?.includes("LOOK:"), false);
    assert.equal(briefLine("tuesday", [oxford, chinos, loafers]), "Tuesday. Wear your oxford with the tan chinos and the suede loafers.");
  });

  it("acceptance: a look question with nothing on screen is not a model pass", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: [],
      screenLooks: [],
    });
    const answer = answerAsked({
      prompt: "What is the strongest look on this page?",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(answer.kind, "answer");
    if (answer.kind === "answer") {
      assert.equal(answer.text, "Nothing is on screen.");
      assert.deepEqual(answer.garmentIds, []);
    }
    // Dressing prompts still pass through to the local handlers.
    const swap = answerAsked({
      prompt: "Swap the shirt",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(swap.kind, "pass");
  });

  it("acceptance: looks that cannot rank answer none holds them", () => {
    writeStylistPage({
      route: "lookbook",
      occasion: "weekday",
      season: "fall",
      onScreenLookIds: ["l1"],
      screenLooks: [{ id: "l1", garmentIds: ["g_missing"] }],
    });
    const answer = answerAsked({
      prompt: "What is the strongest look on this page?",
      page: readStylistPage(),
      garments: owned,
    });
    assert.equal(answer.kind, "answer");
    if (answer.kind === "answer") {
      assert.equal(answer.text, "None of these looks holds them.");
      assert.deepEqual(answer.garmentIds, []);
    }
  });

  it("acceptance: the closed agent is the Stylist chip, not a full-width bar", () => {
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    assert.equal(dock.includes("inset-x-0 bottom-14"), false);
    assert.match(dock, /Stylist/);
    assert.match(dock, /text-ink/);
    // The busy line lives in the open card only.
    const busy = dock.match(/Considering the closet…/g);
    assert.equal(busy?.length, 1);
  });
});

describe("stylist routing", () => {
  /* His real piece names, invented ids. Never a live SKU. */
  const polo = piece({ id: "r_polo", name: "Cream long-sleeve polo", category: "top", subtype: "polo", colors: ["cream"] });
  const cords = piece({ id: "r_cords", name: "Navy corduroy trousers", category: "bottom", subtype: "trousers", colors: ["navy"], material: "corduroy" });
  const woven = piece({ id: "r_woven", name: "Black woven loafers", category: "footwear", subtype: "loafers", colors: ["black"] });
  const field = piece({ id: "r_field", name: "Olive field jacket", category: "outerwear", subtype: "field jacket", colors: ["olive"] });
  const oxfordShirt = piece({ id: "r_ox", name: "White oxford shirt", category: "top", subtype: "oxford", colors: ["white"] });
  const tan = piece({ id: "r_tan", name: "Tan chinos", category: "bottom", subtype: "chinos", colors: ["tan"] });
  const tassel = piece({ id: "r_tassel", name: "Brown suede tassel loafers", category: "footwear", subtype: "loafers", colors: ["brown"], material: "suede" });
  const mules = piece({ id: "r_mules", name: "Brown suede mules", category: "footwear", subtype: "mules", colors: ["brown"], material: "suede" });
  const rack = [polo, cords, woven, field, oxfordShirt, tan, tassel, mules];
  const onScreen = [oxfordShirt.id, tan.id, tassel.id];
  const banned = (s: string) => assert.equal(/LOOK:|\bg_[a-z0-9_]+/i.test(s), false, s);
  function todayPage() {
    writeStylistPage({
      route: "today",
      occasion: "weekday",
      onScreenLookIds: ["today"],
      screenLooks: [{ id: "today", garmentIds: onScreen }],
    });
    return readStylistPage();
  }

  it("1) a named piece off the page passes to the dress branch and gets its look", () => {
    const page = todayPage();
    const q = "what goes with my olive field jacket";
    assert.deepEqual(answerAsked({ prompt: q, page, garments: rack }), { kind: "pass" });
    assert.equal(swapSlot(q), null);
    const named = resolvePiecesFromText(q, rack);
    assert.equal(named[0]?.id, field.id);
    const dressed = dressThisPiece({ lockedIds: [field.id], garments: rack, looks: [], occasion: "weekday", weather: undefined, journal: [] });
    assert.ok(dressed, "dressThisPiece built nothing");
    const reply = lookReply(dressed!.pieces)!;
    assert.match(reply, /^Wear your /);
    assert.ok(reply.includes("Olive field jacket"), reply);
    banned(reply);
    const which = answerAsked({ prompt: "which look has my olive field jacket", page, garments: rack });
    assert.deepEqual(which, { kind: "answer", text: "That piece is not in the looks on this page.", garmentIds: [] });
  });

  it("2) swap the shoes on a fresh Today edits the on-screen look", () => {
    const page = todayPage();
    const q = "swap the shoes";
    const slot = swapSlot(q);
    assert.equal(slot, "footwear");
    const base = swapBaseIds({ previousIds: undefined, page, looks: [{ id: "today", garmentIds: onScreen }], drop: null, garments: rack });
    assert.deepEqual(base, onScreen);
    const edited = swapDraft({ ids: base, slot: slot!, garments: rack, taste: emptyTaste(), occasion: "weekday" });
    const ids = edited?.garmentIds ?? base;
    const pieces = ids.map((id) => rack.find((g) => g.id === id)!).filter(Boolean);
    const reply = lookReply(pieces)!;
    assert.match(reply, /^Wear your /);
    assert.ok(reply.includes("White oxford shirt") && reply.includes("Tan chinos"), reply);
    assert.equal(reply.includes("Brown suede tassel loafers"), false, reply);
    banned(reply);
    assert.deepEqual(swapBaseIds({ previousIds: [polo.id, cords.id, woven.id], page, looks: [], drop: null, garments: rack }), [polo.id, cords.id, woven.id]);
    assert.deepEqual(swapBaseIds({ previousIds: [], page, looks: [], drop: { date: "2026-10-08", garmentIds: [polo.id, cords.id] }, garments: rack, today: "2026-10-08" }), [polo.id, cords.id]);
    assert.deepEqual(swapBaseIds({ previousIds: [], page, looks: [], drop: { date: "2026-10-07", garmentIds: [polo.id, cords.id] }, garments: rack, today: "2026-10-08" }), []);
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const send = dock.slice(dock.indexOf("const send = async"), dock.indexOf("const wearDraft"));
    const todayAt = send.indexOf("isTodayOutfitAsk(q)");
    const swapAt = send.indexOf("swapSlot(q)");
    const askedAt = send.indexOf("answerAsked(");
    assert.ok(todayAt >= 0 && todayAt < swapAt && swapAt < askedAt, "today, then swap, then the page");
    assert.equal(send.split("swapSlot(").length - 1, 1, "one swap branch");
  });

  it("3) a care question passes the page, and the qualifier logic reads suede shoes as owned", () => {
    const page = todayPage();
    const q = "How do I keep suede shoes looking good in the rain?";
    assert.equal(isAdviceAsk(q), true);
    assert.deepEqual(answerAsked({ prompt: q, page, garments: rack }), { kind: "pass" });
    for (const ask of ["what goes with my olive field jacket", "swap the shoes", "What should I wear today?", "what should I wear to dinner tonight"]) {
      assert.equal(isAdviceAsk(ask), false, ask);
    }
    for (const ask of ["suede shoes", "care for suede loafers", "brown shoes"]) {
      assert.notEqual(answerAsked({ prompt: ask, page, garments: rack }).kind, "reject", ask);
    }
    assert.ok(acceptStylistReply("Brush your suede loafers dry and spray them.", rack));
    for (const ask of ["Wear the camel overcoat.", "Pair my Loro Piana cashmere sweater", "do I own a Loro Piana sweater", "how do I clean my camel overcoat"]) {
      assert.equal(answerAsked({ prompt: ask, page, garments: rack }).kind, "reject", ask);
    }
    assert.equal(acceptStylistReply("Wear the camel overcoat.", rack), null);
    assert.equal(acceptStylistReply("Pair the Loro Piana cashmere sweater.", rack), null);
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const send = dock.slice(dock.indexOf("const send = async"), dock.indexOf("const wearDraft"));
    assert.ok(send.indexOf("isAdviceAsk(q)") >= 0 && send.indexOf("isAdviceAsk(q)") < send.indexOf("dressThisPiece("), "advice is checked before the dress branch");
  });

  it("4) a server block paints as one sentence, in every shape", () => {
    const pieces = [polo, cords, woven, field];
    const ids = pieces.map((g) => g.id);
    const block = atlasText({ technique: null, pieces, occasion: "weekday", missing: null });
    const want = "Wear your Cream long-sleeve polo with the Navy corduroy trousers and the Black woven loafers under the Olive field jacket.";
    assert.deepEqual(replyFromStylistResult({ ok: true, text: block, garmentIds: ids }, rack), { text: want, garmentIds: ids });
    assert.deepEqual(replyFromStylistResult({ ok: true, text: block }, rack), { text: want, garmentIds: ids });
    const oneLine = block.replace(/\n/g, " ");
    assert.deepEqual(replyFromStylistResult({ ok: true, text: oneLine, garmentIds: ids }, rack), { text: want, garmentIds: ids });
    assert.equal(looksLikeAtlasBlock(oneLine), true);
    for (const line of visibleReplyLines(oneLine)) banned(line);
    assert.ok(visibleReplyLines(oneLine).length >= 1);
    const prose = replyFromStylistResult({ ok: true, text: "The oxford with the tan chinos and the suede loafers.", garmentIds: [oxfordShirt.id] }, rack);
    assert.equal(prose.text, "The oxford with the tan chinos and the suede loafers.");
  });

  it("5) the today ask and the dinner brief are unchanged", () => {
    const page = todayPage();
    assert.equal(isTodayOutfitAsk("What should I wear today?"), true);
    const drop = { date: "2026-10-08", garmentIds: onScreen, worn: false, verdict: "pending" as const, occasion: "weekday" as const };
    const today = answerTodayAsk({ drop, garments: rack, today: "2026-10-08" });
    assert.equal(today.text, "Wear your White oxford shirt with the Tan chinos and the Brown suede tassel loafers.");
    const dinner = "what should I wear to dinner tonight";
    assert.equal(isTodayOutfitAsk(dinner), false);
    assert.deepEqual(answerAsked({ prompt: dinner, page, garments: rack }), { kind: "pass" });
    assert.equal(briefOccasion(dinner), "out");
    const line = briefLine(dinner, [polo, cords, woven, field]);
    assert.match(line ?? "", /^Dinner\. Wear your /);
  });
});
