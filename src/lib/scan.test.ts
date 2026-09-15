import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chipLabel,
  collectKnownHashes,
  filenameLooksLikeSkip,
  looksInventedExtra,
  parseCropBox,
  parseScanClass,
  pieceFileHash,
  sanitizeScanPieces,
  sanitizeWornBoxes,
  slotFitsCategory,
} from "./scan.ts";

describe("parseScanClass", () => {
  it("skips food", () => {
    const got = parseScanClass('{"kind":"skip","reason":"pizza","pieces":[]}');
    assert.equal(got.kind, "skip");
    assert.deepEqual(got.pieces, []);
    assert.deepEqual(got.boxes, []);
  });

  it("reads a worn selfie of three garments and drops the face", () => {
    const got = parseScanClass(
      JSON.stringify({
        kind: "worn",
        boxes: [
          { name: "Polo", category: "top", x: 0.2, y: 0.12, w: 0.55, h: 0.32 },
          { name: "Cords", category: "bottom", x: 0.22, y: 0.42, w: 0.5, h: 0.34 },
          { name: "Loafers", category: "footwear", x: 0.18, y: 0.78, w: 0.6, h: 0.18 },
          { name: "Face", category: "other", x: 0.35, y: 0.02, w: 0.3, h: 0.14 },
        ],
      }),
    );
    assert.equal(got.kind, "worn");
    assert.deepEqual(
      got.boxes.map((b) => b.chip),
      ["Polo", "Cords", "Loafers"],
    );
    assert.equal(got.boxes.length, 3);
    assert.ok(got.boxes[0]?.box);
    assert.ok(!got.boxes.some((b) => /face|person/i.test(b.name)));
  });

  it("maps old outfit JSON onto worn and drops the person", () => {
    const got = parseScanClass(
      JSON.stringify({
        kind: "outfit",
        pieces: [
          { slot: "top", label: "White oxford" },
          { slot: "bottom", label: "Navy chinos" },
          { slot: "shoes", label: "Brown loafers" },
          { slot: "top", label: "the person" },
        ],
      }),
    );
    assert.equal(got.kind, "worn");
    assert.deepEqual(
      got.pieces.map((p) => p.slot),
      ["top", "bottom", "footwear"],
    );
    assert.ok(!got.pieces.some((p) => /person/i.test(p.label)));
  });

  it("treats a product plate as garment", () => {
    const got = parseScanClass('{"kind":"garment","pieces":[{"slot":"top","label":"Navy oxford"}]}');
    assert.equal(got.kind, "garment");
    assert.equal(got.pieces.length, 1);
    assert.equal(got.pieces[0]?.label, "Navy oxford");
  });

  it("does not invent a second piece when only one is listed", () => {
    const got = parseScanClass(
      '{"kind":"worn","boxes":[{"name":"Cream varsity","category":"outerwear","x":0.1,"y":0.1,"w":0.8,"h":0.7}]}',
    );
    assert.equal(got.boxes.length, 1);
    assert.equal(got.boxes[0]?.chip, "Varsity");
    assert.ok(!got.boxes.some((b) => b.slot === "footwear"));
  });

  it("drops Piece labels", () => {
    const got = parseScanClass(
      '{"kind":"rail","pieces":[{"slot":"top","label":"Piece"},{"slot":"bottom","label":"Olive chinos"}]}',
    );
    assert.equal(got.kind, "worn");
    assert.deepEqual(
      got.pieces.map((p) => p.label),
      ["Olive chinos"],
    );
  });
});

describe("chipLabel", () => {
  it("names Polo / Cords / Loafers", () => {
    assert.equal(chipLabel("Navy polo", "top"), "Polo");
    assert.equal(chipLabel("Brown corduroy", "bottom"), "Cords");
    assert.equal(chipLabel("Brown loafers", "footwear"), "Loafers");
  });
});

describe("parseCropBox", () => {
  it("reads fractions and percents", () => {
    assert.deepEqual(parseCropBox({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 }), {
      x: 0.2,
      y: 0.1,
      w: 0.5,
      h: 0.4,
    });
    const pct = parseCropBox({ left: 20, top: 10, width: 50, height: 40 });
    assert.ok(pct);
    assert.equal(Math.round(pct.x * 100), 20);
  });
});

describe("sanitizeWornBoxes", () => {
  it("caps at 6 and never keeps a face", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `top-${i}`,
      name: `Navy oxford ${i}`,
      chip: `Oxford ${i}`,
      category: "top" as const,
      slot: "top" as const,
      box: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
    }));
    assert.equal(sanitizeWornBoxes(many).length, 6);
    assert.equal(
      sanitizeWornBoxes([
        {
          id: "x",
          name: "Face",
          chip: "Face",
          category: "other",
          slot: "top",
          box: { x: 0.3, y: 0.02, w: 0.3, h: 0.12 },
        },
      ]).length,
      0,
    );
  });
});

describe("sanitizeScanPieces", () => {
  it("caps garment at one and worn at many", () => {
    const many = [
      { slot: "top" as const, label: "Navy oxford" },
      { slot: "top" as const, label: "Grey polo" },
      { slot: "bottom" as const, label: "Khaki chino" },
    ];
    assert.equal(sanitizeScanPieces("garment", many).length, 1);
    assert.equal(sanitizeScanPieces("worn", many).length, 3);
    assert.deepEqual(sanitizeScanPieces("skip", many), []);
  });
});

describe("looksInventedExtra", () => {
  it("rejects white mules when the wanted piece was not white shoes", () => {
    assert.equal(
      looksInventedExtra(
        { slot: "bottom", label: "Cords" },
        { name: "White mules", category: "footwear", colors: ["white"] },
      ),
      true,
    );
    assert.equal(
      looksInventedExtra(
        { slot: "footwear", label: "Brown loafer" },
        { name: "White mules", category: "footwear", colors: ["white"] },
      ),
      true,
    );
    assert.equal(
      looksInventedExtra(
        { slot: "bottom", label: "Cords" },
        { name: "Brown corduroy", category: "bottom", colors: ["brown"] },
      ),
      false,
    );
  });
});

describe("slotFitsCategory", () => {
  it("maps slots to closet categories", () => {
    assert.equal(slotFitsCategory("top", "top"), true);
    assert.equal(slotFitsCategory("bottom", "footwear"), false);
    assert.equal(slotFitsCategory("footwear", "footwear"), true);
  });
});

describe("hashes", () => {
  it("blocks the same JPEG via source hash and piece hash", () => {
    const source = "abc123def";
    const piece = pieceFileHash(source, "top", 0);
    const known = collectKnownHashes([piece, "other"]);
    assert.equal(known.has(source), true);
    assert.equal(known.has(piece), true);
    assert.equal(piece.startsWith(`${source}:`), true);
  });
});

describe("filenameLooksLikeSkip", () => {
  it("catches pizza and receipts", () => {
    assert.equal(filenameLooksLikeSkip("pizza-dinner.jpg"), true);
    assert.equal(filenameLooksLikeSkip("receipt.PNG"), true);
    assert.equal(filenameLooksLikeSkip("navy-oxford.jpg"), false);
  });
});
