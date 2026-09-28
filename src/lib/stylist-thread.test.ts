import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Look } from "./types.ts";

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { recordStylistQuestion, stylistLookToSave } = await import("./stylist-thread.ts");
const { useCloset } = await import("./store.ts");

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
  });
});
