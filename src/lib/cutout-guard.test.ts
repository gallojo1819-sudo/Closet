/**
 * The single-garment guard. A cut-out is stamped matteQuality "clean" only after the check
 * said it shows exactly one piece; "no" (two garments) and "unclear" are busy and reprint,
 * whichever branch of plateResultPatch found the candidate. The second half pins the
 * structure: the branded check has one producer, the literal "clean" lives in plate.ts, and
 * every plate entry point builds its patch through guardedPlatePatch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { officialCoverPatch } from "./packshot.ts";
import {
  cutoutCheckCaption,
  cutoutNeedsRecheck,
  hasCleanCover,
  hasCutout,
  matteFromCheck,
  needsReprintTile,
  plateCandidate,
  plateResultPatch,
} from "./plate.ts";
import { checkSingleGarment, type SingleGarmentCheck } from "./single-garment.ts";

const NOW = () => "2026-10-16T12:00:00.000Z";

/** A mocked vision verdict: the only mock in this file. */
function verdict(one: "yes" | "no" | "unclear", why = ""): Promise<SingleGarmentCheck> {
  return checkSingleGarment(
    { image: "data:image/jpeg;base64,plate", noun: "sweater" },
    async () => ({ one, why }),
    { now: NOW },
  );
}

type Branch = {
  label: string;
  imageSrc: string;
  written: { reprint: boolean; cutoutSrc: string };
  plateKey: string;
  previous: string;
  key: string;
};

/** The three ways plateResultPatch finds a cover to stamp. */
const BRANCHES: Branch[] = [
  {
    label: "a fresh plate",
    imageSrc: "idb:sweater:o",
    written: { reprint: false, cutoutSrc: "data:image/jpeg;base64,plate" },
    plateKey: "idb:sweater:c",
    previous: "",
    key: "idb:sweater:c",
  },
  {
    label: "a kept previous plate",
    imageSrc: "sb:u/sweater/o.jpg",
    written: { reprint: true, cutoutSrc: "" },
    plateKey: "idb:sweater:c",
    previous: "sb:u/sweater/c.jpg",
    key: "sb:u/sweater/c.jpg",
  },
  {
    label: "a stored key the print wrote",
    imageSrc: "sb:u/sweater/o.jpg",
    written: { reprint: false, cutoutSrc: "sb:u/sweater/c-11111111.jpg" },
    plateKey: "idb:sweater:c",
    previous: "",
    key: "sb:u/sweater/c-11111111.jpg",
  },
];

describe("the single-garment guard", () => {
  it("a two-garments verdict is busy and reprint, never clean, in every branch", async () => {
    const two = await verdict("no", "two garments");
    for (const b of BRANCHES) {
      assert.deepEqual(plateCandidate(b.imageSrc, b.written, b.plateKey, b.previous)?.key, b.key, b.label);
      const patch = plateResultPatch(b.imageSrc, b.written, b.plateKey, b.previous, two);
      assert.equal(patch.matteQuality, "busy", b.label);
      assert.notEqual(patch.matteQuality, "clean", b.label);
      assert.equal(patch.reprint, true, b.label);
      assert.equal(patch.cutoutSrc, "", b.label);
      assert.equal("plated" in patch, false, b.label);
      assert.deepEqual(patch.cutoutCheck, { one: "no", why: "two garments", at: NOW() }, b.label);
      const saved = { imageSrc: b.imageSrc, category: "top", ...patch };
      assert.equal(hasCleanCover(saved), false, b.label);
      assert.equal(hasCutout(saved), false, b.label);
      assert.equal(needsReprintTile(saved), true, b.label);
    }
  });

  it("an unclear verdict (a timeout, no answer) is busy too", async () => {
    const unclear = await verdict("unclear", "timeout");
    for (const b of BRANCHES) {
      const patch = plateResultPatch(b.imageSrc, b.written, b.plateKey, b.previous, unclear);
      assert.equal(patch.matteQuality, "busy", b.label);
      assert.equal(patch.reprint, true, b.label);
      assert.equal(patch.cutoutSrc, "", b.label);
      assert.equal(patch.cutoutCheck.one, "unclear", b.label);
    }
  });

  it("a yes verdict is the clean stamp, with the verdict stored beside it", async () => {
    const yes = await verdict("yes");
    for (const b of BRANCHES) {
      const patch = plateResultPatch(b.imageSrc, b.written, b.plateKey, b.previous, yes);
      assert.equal(patch.matteQuality, "clean", b.label);
      assert.equal(patch.reprint, false, b.label);
      assert.equal(patch.plated, true, b.label);
      assert.equal(patch.cutoutSrc, b.key, b.label);
      assert.deepEqual(patch.cutoutCheck, { one: "yes", why: "", at: NOW() }, b.label);
      const saved = { imageSrc: b.imageSrc, category: "top", ...patch };
      assert.equal(hasCleanCover(saved), true, b.label);
      assert.equal(hasCutout(saved), true, b.label);
      assert.equal(cutoutNeedsRecheck(saved), false, b.label);
      assert.equal(cutoutCheckCaption(saved), "", b.label);
    }
  });

  it("a refusal stays a refusal whatever the verdict", async () => {
    const yes = await verdict("yes");
    const refused = plateResultPatch(
      "idb:sweater:o",
      { reprint: true, cutoutSrc: "idb:sweater:o" },
      "idb:sweater:c",
      "",
      yes,
    );
    assert.equal(refused.matteQuality, "busy");
    assert.equal(refused.reprint, true);
    assert.equal(refused.cutoutSrc, "");
    assert.equal(plateCandidate("idb:sweater:o", { reprint: true, cutoutSrc: "idb:sweater:o" }, "idb:sweater:c", ""), null);
  });

  it("matteFromCheck is the stamp the official cover uses too", async () => {
    assert.equal(matteFromCheck(await verdict("yes")).matteQuality, "clean");
    assert.equal(matteFromCheck(await verdict("no")).matteQuality, "busy");
    assert.equal(matteFromCheck(await verdict("unclear")).matteQuality, "busy");
    const model = officialCoverPatch("idb:sweater:c", "https://shop.example/p", await verdict("no", "model"));
    assert.equal(model.matteQuality, "busy");
    assert.equal(model.reprint, true);
    assert.equal(model.cutoutSrc, "");
  });

  it("a stored cut-out with no verdict needs a re-check and says so", () => {
    const unchecked = {
      id: "g_sweater",
      category: "top",
      imageSrc: "sb:u/sweater/o.jpg",
      cutoutSrc: "sb:u/sweater/c.jpg",
      imageSource: "cutout" as const,
      matteQuality: "clean" as const,
    };
    assert.equal(hasCutout(unchecked), true);
    assert.equal(cutoutNeedsRecheck(unchecked), true);
    assert.equal(cutoutCheckCaption(unchecked), "This cut-out was never checked for a single piece.");
    const mixed = { ...unchecked, cutoutCheck: { one: "no" as const, why: "jacket sleeve", at: NOW() } };
    assert.equal(cutoutNeedsRecheck(mixed), true);
    assert.equal(cutoutCheckCaption(mixed), "This cut-out showed more than this piece.");
    const passed = { ...unchecked, cutoutCheck: { one: "yes" as const, why: "", at: NOW() } };
    assert.equal(cutoutNeedsRecheck(passed), false);
    const phone = { ...unchecked, cutoutSrc: unchecked.imageSrc, imageSource: "photo" as const };
    assert.equal(hasCutout(phone), false);
    assert.equal(cutoutNeedsRecheck(phone), false);
    const refused = { ...unchecked, cutoutSrc: "", reprint: true };
    assert.equal(hasCutout(refused), false);
  });
});

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .filter((p) => !p.includes("__fixtures__") && !p.endsWith("routeTree.gen.ts"))
    .map((p) => join(SRC, p));
}

function read(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

describe("every plate entry point goes through the guard", () => {
  it("the branded check has one producer and nothing else casts into it", () => {
    const single = read("lib/single-garment.ts");
    assert.match(single, /declare const CHECKED: unique symbol/);
    assert.doesNotMatch(single, /export (?:const|let|var|declare|function)[^\n]*\bCHECKED\b/);
    assert.doesNotMatch(single, /export \{[^}]*\bCHECKED\b/);
    assert.match(single, /export async function checkSingleGarment\(/);
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      const src = readFileSync(file, "utf8");
      if (rel !== "lib/single-garment.ts") {
        assert.doesNotMatch(src, /as SingleGarmentCheck\b/, `${rel} casts into the brand`);
        /* An angle-bracket cast (`<SingleGarmentCheck>x`), not a generic (`Promise<SingleGarmentCheck>`). */
        assert.doesNotMatch(src, /<SingleGarmentCheck>\s*[\w(]/, `${rel} casts into the brand`);
        assert.doesNotMatch(src, /satisfies SingleGarmentCheck\b/, `${rel} casts into the brand`);
      }
      if (rel !== "lib/plate-pass.ts" && rel !== "lib/single-garment.ts") {
        assert.equal(src.includes("checkSingleGarment("), false, `${rel} runs the check outside the guard`);
      }
    }
    const plate = read("lib/plate.ts");
    assert.match(plate, /export function plateResultPatch\([\s\S]*?check: SingleGarmentCheck,\n\): PlatePatch/);
    assert.match(plate, /export function matteFromCheck\(check: SingleGarmentCheck\)/);
  });

  it('the literal matteQuality "clean" is written in plate.ts only (seed.ts is demo data; a type union is not a write)', () => {
    /* A value write, not a type: `"clean" | ...` unions (types.ts, PlatePatch) do not count. */
    const STAMP = /matteQuality\??:\s*"clean"(?!\s*\|)/g;
    const allowed = new Set(["lib/plate.ts", "lib/seed.ts"]);
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      const src = readFileSync(file, "utf8");
      if (!allowed.has(rel)) {
        assert.doesNotMatch(src, STAMP, `${rel} stamps clean without the check`);
      }
      assert.doesNotMatch(src, /as\s+"clean"/, `${rel} casts to clean`);
      assert.doesNotMatch(src, /matteQuality\s*=\s*"clean"/, `${rel} assigns clean`);
    }
    const plate = read("lib/plate.ts");
    const stamps = plate.match(STAMP) ?? [];
    assert.equal(stamps.length, 1, "one clean stamp, inside matteFromCheck");
    const fn = plate.slice(plate.indexOf("export function matteFromCheck"), plate.indexOf("export function plateCandidate"));
    assert.match(fn, /if \(check\.one === "yes"\) return \{ matteQuality: "clean"/);
  });

  it("the jacket pass, the print queue, the outline crop, the add flow and the official cover build their patch in guardedPlatePatch", () => {
    const pass = read("lib/plate-pass.ts");
    assert.match(pass, /export async function guardedPlatePatch\(/);
    assert.equal((pass.match(/plateResultPatch\(/g) ?? []).length, 1, "plateResultPatch is called once, by the guard");
    const print = pass.slice(pass.indexOf("async function printOnePlate"), pass.indexOf("export function findRealPhoto"));
    assert.match(print, /await guardedPlatePatch\(\{/);
    const search = pass.slice(pass.indexOf("async function searchThenPlate"), pass.indexOf("let plateNote"));
    assert.match(search, /officialCoverPatch\([\s\S]*?await checkCover\(stored, singleGarmentNoun\(g\)\)/);
    assert.match(search, /if \(patch\.matteQuality === "clean"\)/);

    const queue = read("lib/print-queue.ts");
    assert.match(queue, /await guardedPlatePatch\(\{/);
    assert.equal(queue.includes("plateResultPatch"), false);

    const outline = read("components/closet/outline.tsx");
    assert.match(outline, /await guardedPlatePatch\(\{/);
    assert.match(outline, /if \(patch\.matteQuality !== "clean"\) \{[\s\S]*?updateGarment\(garment\.id, patch\)/);
    assert.equal(outline.includes("plateResultPatch"), false);
    assert.match(outline, /recolorFromPlate\(garment\.id, plate\)/);

    const studio = read("components/add/studio.tsx");
    const held = studio.slice(studio.indexOf("const commitHeldPhoto"), studio.indexOf("const processScanFile"));
    assert.match(held, /await guardedPlatePatch\(\{/);
    assert.match(held, /const usePlate = checked\.matteQuality === "clean"/);
    const listing = studio.slice(studio.indexOf("const commit = useCallback"), studio.indexOf("const landMatte"));
    assert.match(listing, /await guardedPlatePatch\(\{/);
    assert.match(listing, /matteQuality: checked\.matteQuality/);
    assert.equal(studio.includes("plateResultPatch"), false);
  });

  it("the detail sheet offers Redo cut-out for any piece with a cut-out, keeps Find the real photo, and recolours from the plate", () => {
    const detail = read("components/closet/detail.tsx");
    assert.match(detail, /\{hasCutout\(garment\) && view !== "me" && \(\s*<button[\s\S]*?Redo cut-out/);
    assert.match(detail, /\(coverIsOriginal\(garment\) \|\| hasCutout\(garment\)\) &&\s*view !== "me" &&\s*maySearchOfficial\(garment\.id, garment\.brand\)/);
    assert.match(detail, /<OutlineJacket\s+garment=\{garment\}/);
    assert.match(detail, /findRealPhoto\(garment\.id, \{ recolor: true \}\)/);
    assert.match(detail, /makePlate\(garment\.id, \{ recolor: true \}\)/);
    assert.match(detail, /cutoutCheckCaption\(garment\)/);
    const pass = read("lib/plate-pass.ts");
    assert.doesNotMatch(pass, /makePlate\(g\.id!, \{/, "the auto pass never recolours");
  });
});
