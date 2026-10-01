import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chipLabel,
  collectKnownHashes,
  coverRejected,
  filenameLooksLikeSkip,
  findThisHref,
  HAND_COVER_MESSAGE,
  isHeldGarment,
  looksInventedExtra,
  parseCropBox,
  parseScanClass,
  pieceFileHash,
  placeHeldGarment,
  sanitizeScanPieces,
  sanitizeWornBoxes,
  slotFitsCategory,
  writtenCutout,
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
    assert.equal(got.kind, "garment");
    assert.equal(got.boxes.length, 1);
    assert.equal(got.boxes[0]?.chip, "Varsity");
    assert.ok(!got.boxes.some((b) => b.slot === "footwear"));
  });

  it("drops Piece labels", () => {
    const got = parseScanClass(
      '{"kind":"rail","pieces":[{"slot":"top","label":"Piece"},{"slot":"bottom","label":"Olive chinos"}]}',
    );
    assert.equal(got.kind, "garment");
    assert.deepEqual(
      got.pieces.map((p) => p.label),
      ["Olive chinos"],
    );
  });

  it("a frame described as one jacket plus a hand is a garment, not worn", () => {
    const got = parseScanClass(
      JSON.stringify({
        kind: "worn",
        reason: "one jacket plus a hand",
        boxes: [
          { name: "Brown jacket", category: "outerwear", x: 0.15, y: 0.08, w: 0.7, h: 0.8 },
          { name: "Hand", category: "accessory", x: 0.02, y: 0.4, w: 0.2, h: 0.35 },
        ],
      }),
    );
    assert.equal(got.kind, "garment");
    assert.equal(got.boxes.length, 1);
    assert.match(got.boxes[0]?.name ?? "", /jacket/i);
    assert.ok(!got.boxes.some((b) => /\bhand\b/i.test(b.name)));
    assert.equal(isHeldGarment(got), true);
  });

  it("a jacket on a hanger is one garment", () => {
    const got = parseScanClass(
      JSON.stringify({
        kind: "worn",
        reason: "jacket on a hanger",
        boxes: [
          { name: "Suede jacket", category: "outerwear", x: 0.2, y: 0.1, w: 0.6, h: 0.75 },
          { name: "Hanger", category: "accessory", x: 0.35, y: 0.02, w: 0.3, h: 0.2 },
        ],
      }),
    );
    assert.equal(got.kind, "garment");
    assert.equal(got.boxes.length, 1);
    assert.equal(isHeldGarment(got), true);
  });

  it("a person wearing a jacket stays worn", () => {
    const got = parseScanClass(
      JSON.stringify({
        kind: "worn",
        reason: "person wearing a jacket",
        boxes: [
          { name: "Brown jacket", category: "outerwear", x: 0.2, y: 0.2, w: 0.55, h: 0.5 },
        ],
      }),
    );
    assert.equal(got.kind, "worn");
    assert.equal(isHeldGarment(got), false);
  });

  it("two garments plus a hand stay worn", () => {
    const got = parseScanClass(
      JSON.stringify({
        kind: "worn",
        reason: "jacket and trousers plus a hand",
        boxes: [
          { name: "Brown jacket", category: "outerwear", x: 0.1, y: 0.1, w: 0.4, h: 0.5 },
          { name: "Olive chinos", category: "bottom", x: 0.45, y: 0.4, w: 0.4, h: 0.45 },
          { name: "Hand", category: "accessory", x: 0.02, y: 0.5, w: 0.15, h: 0.3 },
        ],
      }),
    );
    assert.equal(got.kind, "worn");
    assert.equal(got.boxes.length, 2);
    assert.equal(isHeldGarment(got), false);
  });

  it("does not treat a tote handle as a hand", () => {
    const got = parseScanClass(
      JSON.stringify({
        kind: "worn",
        reason: "jacket and a tote",
        boxes: [
          { name: "Canvas jacket", category: "outerwear", x: 0.1, y: 0.1, w: 0.45, h: 0.6 },
          { name: "Tote handle", category: "accessory", x: 0.6, y: 0.2, w: 0.25, h: 0.4 },
        ],
      }),
    );
    assert.equal(got.kind, "worn");
    assert.equal(got.boxes.length, 2);
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

describe("held garment cover", () => {
  it("calls printGarment before the tile is shown", async () => {
    const order: string[] = [];
    const fetched: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      throw new Error("shop fetch");
    }) as typeof fetch;
    try {
      const written = await placeHeldGarment({
        photo: "photo://jacket",
        print: async () => {
          order.push("print");
          return { ok: true, image: "plate://clean" };
        },
        check: async () => {
          order.push("check");
          return "suede jacket";
        },
        showTile: () => {
          order.push("tile");
        },
        save: () => {
          order.push("save");
        },
      });
      assert.deepEqual(order, ["print", "check", "tile", "save"]);
      assert.equal(written.imageSrc, "photo://jacket");
      assert.equal(written.cutoutSrc, "plate://clean");
      assert.equal(written.message, null);
      assert.deepEqual(fetched, []);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not write a cover the checker still calls hand", async () => {
    let savedCutout = "";
    const written = await placeHeldGarment({
      photo: "photo://jacket",
      print: async () => ({ ok: true, image: "plate://hand" }),
      check: async () => "hand",
      showTile: () => {},
      save: (w) => {
        savedCutout = w.cutoutSrc;
      },
    });
    assert.equal(coverRejected("hand"), true);
    assert.equal(coverRejected("hanger"), true);
    assert.equal(coverRejected("arm"), true);
    assert.equal(coverRejected("skin"), true);
    assert.equal(coverRejected("floor"), true);
    assert.equal(coverRejected("wall"), true);
    assert.equal(coverRejected("no hand"), false);
    assert.equal(coverRejected("no skin"), false);
    assert.equal(coverRejected("without a wall"), false);
    assert.equal(coverRejected("floor removed"), false);
    assert.equal(coverRejected("handle"), false);
    assert.equal(coverRejected("suede jacket on paper"), false);
    assert.equal(written.imageSrc, "photo://jacket");
    assert.equal(written.cutoutSrc, "photo://jacket");
    assert.equal(written.reprint, true);
    assert.notEqual(written.cutoutSrc, "plate://hand");
    assert.equal(savedCutout, "photo://jacket");
    assert.equal(written.message, HAND_COVER_MESSAGE);
    assert.equal(written.message, "Cover still has the hand — tap Reprint.");
    const direct = writtenCutout({
      photo: "photo://jacket",
      plate: "plate://hand",
      checker: "hand",
    });
    assert.equal(direct.cutoutSrc, "photo://jacket");
    assert.equal(direct.reprint, true);
    assert.notEqual(direct.cutoutSrc, "plate://hand");
  });

  it("retries once and keeps a clean plate", async () => {
    const retries: boolean[] = [];
    let shown = "unset";
    const written = await placeHeldGarment({
      photo: "photo://jacket",
      print: async (_photo, attempt) => {
        retries.push(Boolean(attempt?.retry));
        return attempt?.retry
          ? { ok: true, image: "data:image/jpeg;base64,clean" }
          : { ok: true, image: "data:image/jpeg;base64,hand" };
      },
      check: async (plate) => (plate.includes("hand") ? "hand and skin on the wall" : "closed jacket"),
      showTile: (cover) => {
        shown = cover;
      },
      save: () => {},
    });
    assert.deepEqual(retries, [false, true]);
    assert.equal(written.imageSrc, "photo://jacket");
    assert.equal(written.cutoutSrc, "data:image/jpeg;base64,clean");
    assert.equal(written.reprint, false);
    assert.equal(written.message, null);
    assert.equal(shown, "data:image/jpeg;base64,clean");
  });

  it("a dirty retry does not paint the phone photo", async () => {
    let shown = "unset";
    const written = await placeHeldGarment({
      photo: "photo://jacket",
      print: async () => ({ ok: true, image: "plate://hand" }),
      check: async () => "arm and floor",
      showTile: (cover) => {
        shown = cover;
      },
      save: () => {},
    });
    assert.equal(shown, "");
    assert.notEqual(shown, "photo://jacket");
    assert.notEqual(written.cutoutSrc, "plate://hand");
    assert.equal(written.reprint, true);
    assert.equal(written.imageSrc, "photo://jacket");
  });

  it("does not fetch a shop image URL", () => {
    const href = findThisHref("Rhude", "Brown suede jacket");
    assert.equal(
      href,
      `https://www.google.com/search?tbm=isch&q=${encodeURIComponent("Rhude Brown suede jacket")}`,
    );
    assert.equal(/farfetch|ssense|cdn\.|shopify|productimage/i.test(href), false);
    const scanSrc = readFileSync(new URL("./scan.ts", import.meta.url), "utf8");
    const fn = scanSrc.slice(
      scanSrc.indexOf("export async function placeHeldGarment"),
      scanSrc.indexOf("export function findThisHref"),
    );
    assert.equal(fn.includes("fetch("), false);
    const detail = readFileSync(
      new URL("../components/closet/detail.tsx", import.meta.url),
      "utf8",
    );
    const linkAt = detail.indexOf("href={findThisHref");
    assert.ok(linkAt > 0);
    const link = detail.slice(linkAt, linkAt + 360);
    assert.match(link, /Find this/);
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noreferrer noopener"/);
    assert.equal(link.includes("fetch("), false);
    assert.equal(link.includes("cutoutSrc"), false);
    const studio = readFileSync(
      new URL("../components/add/studio.tsx", import.meta.url),
      "utf8",
    );
    assert.match(studio, /placeHeldGarment\(/);
    assert.match(studio, /printGarment\(/);
    const held = studio.slice(
      studio.indexOf("const commitHeldPhoto"),
      studio.indexOf("const processScanFile"),
    );
    assert.equal(held.includes("fetch("), false);
    assert.equal(/farfetch|ssense|searchOfficial|addFromUrl/.test(held), false);
    const ai = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    assert.match(
      ai,
      /Remove the arm, the hand, the sleeve holding it, the hanger, the wall, and the floor\./,
    );
    assert.match(ai, /Keep this exact jacket: suede or canvas, pockets, zipper, collar, color\./);
    assert.match(ai, /Lay it on #F4EFE6\./);
    assert.match(ai, /Closed front, sleeves at the sides, as if on an invisible form\./);
    assert.match(ai, /Not held open\./);
    assert.match(ai, /Not a flat ghost of the lining\./);
    assert.match(ai, /No second garment, no model, no text\./);
    assert.match(ai, /The last plate still showed a person\. Fail if any skin remains\./);
    assert.match(ai, /one garment in a hand, on a hanger, or held up to the camera/);
    assert.match(ai, /A hand and a hanger are not a second garment/);
    const shotAt = studio.indexOf("const takeCameraShot");
    const shot = studio.slice(shotAt, studio.indexOf("useEffect", shotAt));
    assert.match(shot, /imageBorderIsCleanStudio/);
    assert.match(shot, /commitHeldPhoto/);
    assert.equal(shot.includes("isHeldGarment"), false);
    assert.equal(shot.includes("classifyScan"), false);
    const detailBtn = detail.indexOf("Make a plate");
    assert.ok(detailBtn > 0);
    const tile = readFileSync(
      new URL("../components/closet/tile.tsx", import.meta.url),
      "utf8",
    );
    assert.match(tile, /Reprint/);
    assert.match(tile, /REPRINT_CAPTION/);
    const pass = readFileSync(new URL("./plate-pass.ts", import.meta.url), "utf8");
    assert.equal(pass.includes("sync.ts"), false);
    assert.match(pass, /runPlatePass/);
    assert.match(pass, /, 2\)/);
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
