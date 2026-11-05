import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notePushSettled, onPushSettled } from "./cloud/edit.ts";
import { NEW_PIECE_NAME } from "./ingest.ts";
import {
  categoryWrite,
  isFreshPiece,
  nameOfferFromNotes,
  notesBlurPlan,
  removeTap,
  shownField,
} from "./piece-sheet.ts";
import { persistGate } from "./store-persist.ts";
import type { Category, Garment } from "./types.ts";

function piece(
  partial: Partial<Garment> & Pick<Garment, "id" | "name" | "category">,
): Garment {
  return {
    subtype: "",
    colors: [],
    material: "",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 3,
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-10-23T16:40:00.000Z",
    ...partial,
  };
}

describe("piece sheet edits", () => {
  it("a fresh piece saves notes and does not match the cover", () => {
    const g = piece({
      id: "g_jih4sve2486d",
      name: NEW_PIECE_NAME,
      category: "other",
      notes: "",
    });
    assert.equal(isFreshPiece(g), true);
    const notes = "Brown suede horsebit loafers";
    const offer = nameOfferFromNotes(g, notes);
    assert.equal(offer?.name, notes);
    assert.equal(offer?.category, "footwear");
    assert.equal(offer?.subtype, "loafers");
    assert.equal(
      notesBlurPlan({ fresh: true, canPrint: true, notes, unchanged: false, offer: true }),
      "save",
    );
    assert.equal(
      notesBlurPlan({ fresh: false, canPrint: true, notes, unchanged: false, offer: false }),
      "match",
    );
  });

  it("choosing footwear writes that category", () => {
    assert.deepEqual(categoryWrite("footwear", undefined), { category: "footwear" });
    assert.deepEqual(categoryWrite("footwear", true), { category: "footwear", needsCategory: false });
    const patch = categoryWrite("footwear" as Category, undefined);
    assert.equal(patch.category, "footwear");
  });

  it("the first Remove tap does not tombstone", () => {
    const first = removeTap(false);
    assert.equal(first.remove, false);
    assert.equal(first.confirm, true);
    const second = removeTap(true);
    assert.equal(second.remove, true);
  });

  it("an open sheet follows the store unless the field is focused", () => {
    assert.equal(shownField("New piece", "New piece", false), "New piece");
    assert.equal(shownField("Brown suede horsebit loafers", "New piece", false), "Brown suede horsebit loafers");
    assert.equal(shownField("loafers", "loafer", false), "loafers");
    assert.equal(shownField("Brown suede horsebit loafers", "typing", true), "typing");
    assert.equal(shownField("loafers", "boot", true), "boot");
  });

  it("a push shows Saved only when it lands, and the failure in the sheet", () => {
    const lines: string[] = [];
    const stop = onPushSettled((result) => {
      lines.push(result.ok ? "Saved" : result.message);
    });
    notePushSettled({ ok: false, kind: "refused", message: "Didn't save — that would drop pieces you didn't delete." });
    notePushSettled({ ok: false, kind: "error", message: "Couldn't save." });
    notePushSettled({ ok: false, kind: "offline", message: "Couldn't save. Retry" });
    notePushSettled({ ok: true });
    stop();
    assert.deepEqual(lines, [
      "Didn't save — that would drop pieces you didn't delete.",
      "Couldn't save.",
      "Couldn't save. Retry",
      "Saved",
    ]);
    assert.equal(persistGate.open, false);
  });
});
