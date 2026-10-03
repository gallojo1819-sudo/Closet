import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { borderIsCleanStudio } from "./matte.ts";
import {
  coverIsOriginal,
  coverStillPhoto,
  needsReprintTile,
  hasCleanCover,
  jacketsNeedingPlate,
  keptPlateKey,
  noteBlob,
  plateResultPatch,
  rawOuterwearCovers,
  REPRINT_CAPTION,
  resetBlobHashes,
  runPlatePass,
} from "./plate.ts";

const photo = {
  id: "suede",
  name: "Brown suede jacket",
  category: "outerwear",
  imageSrc: "idb:suede:o",
  cutoutSrc: "idb:suede:c",
  imageSource: "photo",
};

describe("studio border", () => {
  it("a white seamless border is a studio ground", () => {
    assert.equal(borderIsCleanStudio({ r: 250, g: 250, b: 250 }, 0.01, 2, false), true);
  });

  it("a room, a page, or a cream wall is not", () => {
    assert.equal(borderIsCleanStudio({ r: 140, g: 110, b: 80 }, 0.3, 20, false), false);
    assert.equal(borderIsCleanStudio({ r: 250, g: 250, b: 250 }, 0.01, 1, true), false);
    assert.equal(borderIsCleanStudio({ r: 244, g: 239, b: 230 }, 0.02, 2, false), false);
  });
});

describe("raw outerwear covers", () => {
  it("includes a phone cover and skips a plate", () => {
    const blazer = {
      id: "blazer",
      name: "Navy blazer",
      category: "outerwear",
      imageSrc: "idb:blazer:o",
      cutoutSrc: "idb:blazer:c",
      imageSource: "official",
    };
    const toggle = {
      id: "toggle",
      name: "White beige toggle jacket",
      category: "outerwear",
      imageSrc: "sb:u/toggle/o.jpg",
      cutoutSrc: "sb:u/toggle/c.jpg",
      imageSource: "cutout",
    };
    const field = {
      id: "field",
      name: "Navy field jacket",
      category: "outerwear",
      imageSrc: "idb:field:o",
      cutoutSrc: "idb:field:o",
      imageSource: "photo",
    };
    const jeans = {
      id: "jeans",
      name: "Light blue jeans",
      category: "bottom",
      imageSrc: "idb:jeans:o",
      cutoutSrc: "idb:jeans:o",
      imageSource: "photo",
    };
    const chosen = {
      ...photo,
      id: "chosen",
      reprint: false as const,
    };
    const picked = rawOuterwearCovers([photo, blazer, toggle, field, jeans, chosen]);
    assert.deepEqual(picked.map((g) => g.id), ["suede", "field"]);
    assert.equal(coverIsOriginal(blazer), false);
    assert.equal(coverIsOriginal(toggle), false);
    assert.equal(needsReprintTile(photo), true);
    assert.equal(needsReprintTile(blazer), false);
    assert.equal(needsReprintTile(toggle), false);
    assert.equal(needsReprintTile({ ...jeans, reprint: true }), true);
    assert.equal(needsReprintTile(chosen), true);
    assert.equal(hasCleanCover(chosen), false);
    assert.equal(hasCleanCover(blazer), true);
    assert.equal(coverStillPhoto(chosen), false);
    assert.equal(coverIsOriginal(chosen), true);
    const catalog = {
      id: "cat",
      category: "outerwear",
      imageSrc: "/x.jpg",
      cutoutSrc: "/x.jpg",
      imageSource: "official",
    };
    const missing = {
      id: "miss",
      category: "outerwear",
      imageSrc: "idb:miss:o",
      cutoutSrc: "",
      imageSource: "cutout",
    };
    const heldNote = {
      id: "held",
      category: "outerwear",
      imageSrc: "idb:held:o",
      cutoutSrc: "idb:held:c",
      imageSource: "cutout",
      notes: "held in a hand",
    };
    assert.equal(hasCleanCover(catalog), true);
    assert.equal(hasCleanCover(heldNote), false);
    const queued = jacketsNeedingPlate([
      photo,
      blazer,
      toggle,
      field,
      jeans,
      chosen,
      catalog,
      missing,
      { ...heldNote, cutoutSrc: "idb:held:o" },
    ]);
    assert.deepEqual(
      queued.map((g) => g.id),
      ["suede", "field", "chosen", "miss", "held"],
    );
  });
});

describe("a camera photo labeled cutout is not a plate", () => {
  const camera = {
    id: "camera-jacket",
    category: "outerwear",
    notes: "camera",
    imageSource: "cutout" as const,
    reprint: false as const,
    cutoutSrc: "c-693a12d9.jpg",
    imageSrc: "o.jpg",
  };
  const blazer = {
    id: "blazer",
    name: "Navy blazer",
    category: "outerwear",
    imageSrc: "sb:u/blazer/o.jpg",
    cutoutSrc: "sb:u/blazer/c.jpg",
    imageSource: "official" as const,
  };
  const toggle = {
    id: "toggle",
    name: "White beige toggle jacket",
    category: "outerwear",
    imageSrc: "sb:u/toggle/o.jpg",
    cutoutSrc: "sb:u/toggle/c.jpg",
    imageSource: "cutout" as const,
  };

  it("queues the phone photo and stamps only a real plate", () => {
    assert.equal("plated" in camera, false);
    assert.equal(camera.reprint, false);
    assert.equal(hasCleanCover(camera), false);
    assert.equal(keptPlateKey(camera), "");
    assert.equal(needsReprintTile(camera), true);
    const queued = jacketsNeedingPlate([camera, blazer, toggle]);
    assert.deepEqual(
      queued.map((g) => g.id),
      ["camera-jacket"],
    );
    assert.equal(hasCleanCover(blazer), true);
    assert.equal(hasCleanCover(toggle), true);
    assert.equal(hasCleanCover({ ...blazer, notes: "photographic" }), true);
    assert.equal(
      hasCleanCover({ ...camera, id: "jeans", category: "bottom" }),
      true,
    );

    const printed = plateResultPatch(
      camera.imageSrc,
      { reprint: false, cutoutSrc: "data:image/jpeg;base64,plate" },
      "c-aabbccdd.jpg",
      keptPlateKey(camera),
    );
    assert.equal(printed.plated, true);
    assert.equal(printed.cutoutSrc, "c-aabbccdd.jpg");
    assert.equal(printed.reprint, false);
    assert.equal("imageSrc" in printed, false);
    const saved = { ...camera, ...printed };
    assert.equal(saved.imageSrc, "o.jpg");
    assert.notEqual(saved.cutoutSrc, camera.cutoutSrc);
    assert.equal(hasCleanCover(saved), true);
    assert.equal(jacketsNeedingPlate([saved]).length, 0);

    const refused = plateResultPatch(
      camera.imageSrc,
      { reprint: true, cutoutSrc: camera.imageSrc },
      "c-aabbccdd.jpg",
      keptPlateKey(camera),
    );
    assert.equal("plated" in refused, false);
    assert.equal(refused.cutoutSrc, "");
    assert.equal(refused.reprint, true);
    assert.equal(refused.imageSource, "cutout");
    assert.notEqual(refused.cutoutSrc, camera.imageSrc);
    assert.notEqual(refused.cutoutSrc, camera.cutoutSrc);
    const paper = { ...camera, ...refused };
    assert.equal(paper.imageSrc, "o.jpg");
    assert.equal(hasCleanCover(paper), false);
    assert.equal(needsReprintTile(paper), true);
    assert.equal(REPRINT_CAPTION, "Plate failed — outline the jacket.");
  });

  it("the signed-in closet pass does not skip reprint false", () => {
    const route = readFileSync(new URL("../routes/closet.tsx", import.meta.url), "utf8");
    assert.match(route, /jacketsNeedingPlate\(garmentsAll\)/);
    assert.equal(route.includes("rawOuterwearCovers"), false);
  });
});

describe("plate patch", () => {
  it("writes the plate key and never imageSrc", () => {
    const ok = plateResultPatch(
      "idb:suede:o",
      { reprint: false, cutoutSrc: "data:image/jpeg;base64,plate" },
      "idb:suede:c",
    );
    assert.equal("imageSrc" in ok, false);
    assert.equal(ok.cutoutSrc, "idb:suede:c");
    assert.equal(ok.imageSource, "cutout");
    assert.equal(ok.reprint, false);
    const refused = plateResultPatch(
      "idb:suede:o",
      { reprint: true, cutoutSrc: "idb:suede:o" },
      "idb:suede:c",
    );
    assert.equal(refused.cutoutSrc, "");
    assert.equal(refused.imageSource, "cutout");
    assert.notEqual(refused.imageSource, "photo");
    assert.equal(refused.reprint, true);
    assert.notEqual(refused.cutoutSrc, "idb:suede:o");
    assert.notEqual(refused.cutoutSrc, "idb:suede:c");
    assert.equal("imageSrc" in refused, false);
    const kept = plateResultPatch(
      "idb:suede:o",
      { reprint: true, cutoutSrc: "" },
      "idb:suede:c",
      "idb:suede:c",
    );
    assert.equal(kept.cutoutSrc, "idb:suede:c");
    assert.equal(kept.reprint, false);
    assert.equal("imageSrc" in kept, false);
    assert.equal(REPRINT_CAPTION, "Plate failed — outline the jacket.");
  });
});

describe("a copied phone photo is not a plate", () => {
  it("identical bytes are not a clean cover when the file names differ", async () => {
    resetBlobHashes();
    const phone = new Blob(["hanger-photo"]);
    const plate = new Blob(["closed-jacket-on-paper"]);
    const copy = {
      id: "suede-copy",
      name: "Brown suede",
      category: "outerwear",
      imageSrc: "sb:user/suede/o.jpg",
      cutoutSrc: "sb:user/suede/c-693a12d9.jpg",
      imageSource: "cutout" as const,
    };
    const real = {
      id: "blazer-plate",
      name: "Navy blazer",
      category: "outerwear",
      imageSrc: "sb:user/blazer/o.jpg",
      cutoutSrc: "sb:user/blazer/c-11111111.jpg",
      imageSource: "cutout" as const,
    };
    await noteBlob(copy.cutoutSrc, phone);
    await noteBlob(copy.imageSrc, phone);
    await noteBlob(real.cutoutSrc, plate);
    await noteBlob(real.imageSrc, phone);
    assert.equal(copy.cutoutSrc === copy.imageSrc, false);
    assert.equal(copy.imageSource, "cutout");
    assert.equal(hasCleanCover(copy), false);
    assert.equal(hasCleanCover(real), true);
    assert.equal(keptPlateKey(copy), "");
    assert.equal(keptPlateKey(real), real.cutoutSrc);
    const queued = jacketsNeedingPlate([copy, real]);
    assert.deepEqual(
      queued.map((g) => g.id),
      ["suede-copy"],
    );
    const refused = plateResultPatch(
      copy.imageSrc,
      { reprint: true, cutoutSrc: "" },
      "idb:suede-copy:c",
      copy.cutoutSrc,
    );
    assert.equal(refused.cutoutSrc, "");
    assert.equal(refused.reprint, true);
    assert.equal("imageSrc" in refused, false);
    assert.notEqual(refused.cutoutSrc, copy.cutoutSrc);
    const marked = plateResultPatch(
      copy.imageSrc,
      { reprint: false, cutoutSrc: copy.cutoutSrc },
      "idb:suede-copy:c",
      copy.cutoutSrc,
    );
    assert.equal(marked.cutoutSrc, "");
    assert.equal(marked.reprint, true);
    assert.equal("imageSrc" in marked, false);
    resetBlobHashes();
  });
});

describe("plate pass", () => {
  it("runs two at a time and does not drop items", async () => {
    let active = 0;
    let max = 0;
    const seen: number[] = [];
    await runPlatePass(
      [1, 2, 3, 4],
      async (n) => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        seen.push(n);
      },
      2,
    );
    assert.equal(max, 2);
    assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4]);
  });
});
