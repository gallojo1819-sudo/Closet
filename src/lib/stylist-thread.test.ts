import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Garment, Look } from "./types.ts";

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { draftFromMessage, recordStylistQuestion, stylistLookToSave } = await import("./stylist-thread.ts");
const { useCloset } = await import("./store.ts");
const { clearPendingEdit, peekPendingEdit } = await import("./cloud/edit.ts");

const QUESTION = "What should I wear to a weekday office day this fall?";

function olive(): Look {
  return {
    id: "l_olive",
    name: "Olive field jacket · weekday",
    occasion: "weekday",
    garmentIds: ["g_jacket", "g_chino", "g_loafer"],
    source: "manual",
    lookbook: false,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("stylist ask", () => {
  it("a question does not write a look or Today, and Save adds one ai look", () => {
    const drop = {
      date: "2026-09-28",
      garmentIds: ["g_jacket", "g_chino", "g_loafer"],
      worn: false,
      verdict: "pending" as const,
      occasion: "weekday" as const,
    };
    useCloset.setState({ looks: [olive()], drop });
    const before = useCloset.getState();
    const staged = recordStylistQuestion(before, QUESTION);
    assert.equal(staged.looks, before.looks.length);
    assert.equal(staged.drop, before.drop);
    assert.equal(useCloset.getState().looks.length, before.looks.length);
    assert.equal(useCloset.getState().drop, before.drop);
    assert.equal(useCloset.getState().looks[0]?.name, "Olive field jacket · weekday");

    const id = useCloset.getState().saveLook(
      stylistLookToSave({
        name: "Navy oxford · weekday",
        occasion: "weekday",
        garmentIds: ["g_ox", "g_chino", "g_loafer"],
      }),
    );
    const looks = useCloset.getState().looks;
    assert.equal(looks.length, before.looks.length + 1);
    assert.equal(looks.find((look) => look.id === id)?.source, "ai");
    assert.equal(
      looks.some((look) => look.name === "Olive field jacket · weekday"),
      true,
    );

    const src = readFileSync(new URL("../routes/stylist.tsx", import.meta.url), "utf8");
    const send = src.slice(src.indexOf("const send"), src.indexOf("const wearDraft"));
    assert.equal(send.includes("saveLook"), false);
    assert.equal(send.includes("setDrop"), false);
    assert.equal(send.includes("outfitWith"), false);
    assert.equal(src.includes("stylistLookToSave"), true);
    assert.equal(src.includes("draftFromMessage"), true);
    assert.equal(src.includes("setDrafts"), false);
  });

  it("outfitWith does not change Today or the lookbook rev until Save", () => {
    const garment = (
      partial: Pick<Garment, "id" | "name" | "category" | "subtype">,
    ): Garment => ({
      colors: ["navy"],
      material: "cotton",
      brand: "",
      notes: "",
      formality: 3,
      warmth: 2,
      seasons: ["fall"],
      imageSrc: "/x.jpg",
      cutoutSrc: "/x.jpg",
      imageSource: "official",
      matteQuality: "clean",
      demo: false,
      archived: false,
      wornOn: [],
      createdAt: "2026-01-01T12:00:00.000Z",
      ...partial,
    });
    const drop = {
      date: "2026-09-30",
      garmentIds: ["ox", "chino", "loafer"],
      worn: false,
      verdict: "pending" as const,
      occasion: "weekday" as const,
    };
    useCloset.setState({
      garments: [
        garment({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
        garment({ id: "chino", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
        garment({ id: "loafer", name: "Brown penny loafers", category: "footwear", subtype: "loafer" }),
      ],
      looks: [olive()],
      drop,
      messages: [],
    });
    clearPendingEdit();
    const before = useCloset.getState();
    const draft = before.outfitWith(["ox"], "weekday");
    assert.ok(draft);
    assert.notEqual(draft.source, "manual");
    assert.equal(draft.lookbook, false);
    assert.equal(draft.id.startsWith("draft_"), true);
    assert.equal(useCloset.getState().looks.length, before.looks.length);
    assert.equal(useCloset.getState().drop, before.drop);
    assert.equal(peekPendingEdit(), false);
    useCloset.getState().saveLook({
      name: draft.name,
      occasion: "weekday",
      garmentIds: draft.garmentIds,
      source: "manual",
      lookbook: false,
    });
    assert.equal(useCloset.getState().looks.length, before.looks.length + 1);
    assert.equal(peekPendingEdit(), true);
    assert.equal(useCloset.getState().drop, before.drop);
  });

  it("a stylist draft stays on the message across the store and Save writes one ai look", () => {
    useCloset.setState({ looks: [olive()], messages: [], drop: null });
    clearPendingEdit();
    const before = useCloset.getState().looks.length;
    const id = useCloset.getState().pushMessage({
      role: "stylist",
      text: "RRL × weekday\nMISSING: Closest RRL from your closet. Boots would finish it.",
      garmentIds: ["g_jean", "g_shirt", "g_boot"],
      draftName: "Indigo work shirt · weekday",
      draftOccasion: "weekday",
    });
    const message = useCloset.getState().messages.find((m) => m.id === id);
    assert.ok(message);
    const draft = draftFromMessage(message);
    assert.ok(draft);
    assert.deepEqual(draft.garmentIds, ["g_jean", "g_shirt", "g_boot"]);
    assert.equal(useCloset.getState().looks.length, before);
    assert.equal(peekPendingEdit(), false);
    const saved = useCloset.getState().saveLook(stylistLookToSave(draft));
    useCloset.getState().stampMessage(id, { lookId: saved });
    const again = useCloset.getState().messages.find((m) => m.id === id);
    assert.equal(again?.lookId, saved);
    assert.equal(draftFromMessage(again!)?.name, "Indigo work shirt · weekday");
    assert.equal(useCloset.getState().looks.find((look) => look.id === saved)?.source, "ai");
    assert.equal(useCloset.getState().looks.length, before + 1);
  });
});
