import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectKnownHashes,
  filenameLooksLikeSkip,
  looksInventedExtra,
  parseScanClass,
  pieceFileHash,
  sanitizeScanPieces,
  slotFitsCategory,
} from "./scan.ts";

describe("parseScanClass", () => {
  it("skips food", () => {
    const got = parseScanClass('{"kind":"skip","reason":"pizza","pieces":[]}');
    assert.equal(got.kind, "skip");
    assert.deepEqual(got.pieces, []);
  });

  it("reads an outfit of three garments and drops the person", () => {
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
    assert.equal(got.kind, "outfit");
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
      '{"kind":"outfit","pieces":[{"slot":"top","label":"Cream varsity"}]}',
    );
    assert.equal(got.pieces.length, 1);
    assert.equal(got.pieces[0]?.label, "Cream varsity");
    assert.ok(!got.pieces.some((p) => p.slot === "footwear"));
  });

  it("drops Piece labels", () => {
    const got = parseScanClass(
      '{"kind":"rail","pieces":[{"slot":"top","label":"Piece"},{"slot":"bottom","label":"Olive chinos"}]}',
    );
    assert.deepEqual(
      got.pieces.map((p) => p.label),
      ["Olive chinos"],
    );
  });
});

describe("sanitizeScanPieces", () => {
  it("caps garment at one and rail at many", () => {
    const many = [
      { slot: "top" as const, label: "Navy oxford" },
      { slot: "top" as const, label: "Grey polo" },
      { slot: "bottom" as const, label: "Khaki chino" },
    ];
    assert.equal(sanitizeScanPieces("garment", many).length, 1);
    assert.equal(sanitizeScanPieces("rail", many).length, 3);
    assert.deepEqual(sanitizeScanPieces("skip", many), []);
  });
});

describe("looksInventedExtra", () => {
  it("rejects white mules when the wanted piece was not white shoes", () => {
    assert.equal(
      looksInventedExtra(
        { slot: "bottom", label: "Navy chinos" },
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
        { slot: "footwear", label: "White mules" },
        { name: "White mules", category: "footwear", colors: ["white"] },
      ),
      false,
    );
    assert.equal(
      looksInventedExtra(
        { slot: "top", label: "White oxford" },
        { name: "White oxford", category: "top", colors: ["white"] },
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
