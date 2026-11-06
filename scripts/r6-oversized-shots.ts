/**
 * R6 screenshots. Seeds the browser's localStorage only. Does not write closet.v6 on disk.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { liveSnapshot } from "/agent/repos/Closet/src/lib/__fixtures__/snapshot.ts";
import { packPersist } from "/agent/repos/Closet/src/lib/store-persist.ts";
import type { Garment } from "/agent/repos/Closet/src/lib/types.ts";

const BASE = process.env.CLOSET_URL ?? "http://127.0.0.1:8080";
const OUT = process.argv[2] ?? "/opt/cursor/artifacts/r6";

function freshPiece(): Garment {
  const sample = liveSnapshot.find((g) => g.category === "top")!;
  return {
    ...sample,
    id: "g_r6newpiece",
    name: "New piece",
    subtype: "camp shirt",
    category: "top",
    notes: "",
    colors: ["lilac"],
    material: "linen",
    fit: "regular",
    oversized: undefined,
    tuck: undefined,
    archived: false,
    demo: false,
    wornOn: [],
    createdAt: "2026-11-06T15:00:00.000Z",
  };
}

async function openPiece(page: Page, category: string, label: string) {
  await page.goto(`${BASE}/closet`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  const filter = page.getByRole("button", { name: new RegExp(`^${category}$`, "i") });
  await filter.click();
  await page.getByText(label, { exact: true }).first().waitFor({ timeout: 15000 });
  const tileText = page.getByText(label, { exact: true }).first();
  await tileText.scrollIntoViewIfNeeded();
  const tile = page.getByRole("button", { name: label });
  await tile.click();
  await page.locator("[data-oversized-row]").waitFor({ timeout: 15000 });
}

async function shot(page: Page, name: string) {
  const row = page.locator("[data-oversized-row]");
  if (await row.count()) await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("shot", name);
}

async function flow(page: Page, width: number, height: number, tag: string) {
  await page.setViewportSize({ width, height });
  await openPiece(page, "top", "navy sweater");
  await shot(page, `${tag}-navy-on`);
  await page.locator("[data-oversized-row]").getByRole("button", { name: "Off", exact: true }).click();
  await page.locator('[data-oversized-value="off"][aria-pressed="true"]').waitFor();
  await shot(page, `${tag}-navy-off`);
  await page.locator("[data-oversized-row]").getByRole("button", { name: "On", exact: true }).click();
  await page.locator('[data-oversized-value="on"][aria-pressed="true"]').waitFor();
  await shot(page, `${tag}-navy-on-again`);

  await page.keyboard.press("Escape");
  await openPiece(page, "outerwear", "brown chore jacket");
  const off = page.locator('[data-oversized-value="off"][aria-pressed="true"]');
  if (!(await off.count())) throw new Error("chore is not Off");
  await shot(page, `${tag}-chore-off`);

  await page.keyboard.press("Escape");
  await openPiece(page, "top", "Lilac linen camp shirt");
  if (!(await off.count())) throw new Error("new piece is not Off");
  await shot(page, `${tag}-new-off`);

  await page.keyboard.press("Escape");
  await openPiece(page, "top", "grey long-sleeve polo");
  await page.getByRole("button", { name: /^\d+ looks? with this$/ }).click();
  await page.locator("[data-hero-list]").waitFor({ timeout: 30000 });
  const poloText = await page.locator("[data-hero-list]").innerText();
  if (/blazer|field jacket|toggle/i.test(poloText)) {
    throw new Error(`grey polo list shows a regular jacket:\n${poloText}`);
  }
  await shot(page, `${tag}-polo-looks`);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openPiece(page, "top", "grey knit sweater");
  await page.getByRole("button", { name: /^\d+ looks? with this$/ }).click();
  await page.locator("[data-hero-list]").waitFor({ timeout: 30000 });
  const knitText = await page.locator("[data-hero-list]").innerText();
  if (!/corduroy/i.test(knitText)) throw new Error(`grey knit list has no corduroy:\n${knitText}`);
  await shot(page, `${tag}-knit-looks`);
  const weekday = page.locator("[data-hero-list] li").filter({ hasText: "weekday · untucked" }).first();
  await weekday.scrollIntoViewIfNeeded();
  await shot(page, `${tag}-knit-weekday-card`);
  await weekday.locator("button").click();
  await page.locator("[data-look-back]").waitFor();
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("p")];
    const shown = nodes.find((node) => {
      if (!/untucked/i.test(node.textContent ?? "")) return false;
      const style = getComputedStyle(node);
      return style.visibility !== "hidden" && style.display !== "none";
    });
    shown?.scrollIntoView({ block: "center" });
  });
  await shot(page, `${tag}-knit-weekday-plate`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const garments = liveSnapshot.map((g) => {
    if (g.id !== "g_8qqqzpwxuwti") return g;
    // The closet opens the outline tool for an outer without a clean plate.
    // The browser seed marks this copy plated so the sheet, and the Oversized row, can open.
    return {
      ...g,
      imageSource: "official" as const,
      cutoutSrc: "shot-plate",
      imageSrc: "shot-original",
      reprint: false,
    };
  });
  const packed = packPersist({
    garments: [...garments, freshPiece()],
    looks: [],
    journal: [],
    avoid: {},
    drop: null,
    refPhoto: null,
    refPhotoBackup: null,
    messages: [],
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript((raw) => {
    localStorage.setItem("closet.v6", raw);
  }, packed);
  try {
    await flow(page, 1280, 800, "1280");
    await flow(page, 375, 812, "375");
  } catch (err) {
    await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
    console.error(errors.slice(0, 6).join("\n"));
    throw err;
  } finally {
    await browser.close();
  }
  if (errors.length) console.log("page errors", errors.slice(0, 6));
  console.log("shots ok", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
