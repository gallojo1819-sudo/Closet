/**
 * Browser check for the closet piece → list → look stack.
 * Uses the snapshot closet in this browser only. No On You, no xAI.
 *
 *   TZ=America/New_York XAI_API_KEY= node --experimental-strip-types scripts/r5-looks-back-shots.ts
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { liveSnapshot } from "../src/lib/__fixtures__/snapshot.ts";
import { derivedCategory } from "../src/lib/garment-category.ts";
import { looksForHero } from "../src/lib/lookbook.ts";
import { pieceLabel } from "../src/lib/piece-label.ts";
import { needsReprintTile } from "../src/lib/plate.ts";
import { packPersist } from "../src/lib/store-persist.ts";
import type { Garment, Look } from "../src/lib/types.ts";

const BASE = process.env.CLOSET_URL ?? "http://127.0.0.1:8080";
const OUT = process.env.R5_SHOTS ?? "/opt/cursor/artifacts";

function cardsOf(looks: Look[], garments: Garment[]): Look[] {
  const ids = new Set(garments.map((g) => g.id));
  return looks.filter((look) => look.garmentIds.filter((id) => ids.has(id)).length >= 3);
}

function pickHero(): { garment: Garment; label: string; category: string } {
  const labels = new Map<string, number>();
  for (const garment of liveSnapshot) {
    const label = pieceLabel(garment, liveSnapshot);
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  for (const garment of liveSnapshot) {
    if (garment.archived) continue;
    if (needsReprintTile(garment)) continue;
    const category = derivedCategory(garment);
    const label = pieceLabel(garment, liveSnapshot);
    if ((labels.get(label) ?? 0) !== 1) continue;
    const cards = cardsOf(looksForHero(garment, liveSnapshot), liveSnapshot);
    if (cards.length >= 3) return { garment, label, category };
  }
  throw new Error("no snapshot piece with three or more looks");
}

function shot(name: string): string {
  return `${OUT}/${name}.png`;
}

async function assertBackInView(page: Page, width: number, height: number) {
  const box = await page.locator("[data-look-back]").boundingBox();
  if (!box) throw new Error(`Back has no box at ${width}x${height}`);
  if (box.y < 0 || box.y >= height) {
    throw new Error(`Back top ${box.y} is outside ${width}x${height}`);
  }
  const hit = await page.locator("[data-look-back]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + 2);
    return Boolean(top && (top === el || el.contains(top)));
  });
  if (!hit) throw new Error(`Back is covered at ${width}x${height}`);
}

async function scrollList(page: Page): Promise<number> {
  const scrolled = await page.locator("[data-hero-list]").evaluate((el) => {
    const max = el.scrollHeight - el.clientHeight;
    const top = Math.max(0, Math.min(max, Math.max(80, Math.round(max * 0.55))));
    el.scrollTop = top;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    return { top: el.scrollTop, max };
  });
  if (scrolled.max < 40 || scrolled.top < 40) {
    throw new Error(`list did not scroll (top ${scrolled.top}, max ${scrolled.max})`);
  }
  return scrolled.top;
}

async function openStack(page: Page, label: string) {
  const tileText = page.getByText(label, { exact: true }).first();
  await tileText.scrollIntoViewIfNeeded();
  const tile = page.getByRole("button", { name: label });
  await tile.waitFor({ timeout: 15000 });
  await tile.click();
  const looksBtn = page.getByRole("button", { name: /^\d+ looks? with this$/ });
  await looksBtn.waitFor({ timeout: 30000 });
  await looksBtn.click();
  await page.locator("[data-hero-list]").waitFor();
  await page.locator("[data-hero-heading]").waitFor();
}

async function flow(
  page: Page,
  width: number,
  height: number,
  tag: string,
  hero: { label: string; category: string; name: string },
  full: boolean,
) {
  console.log(`flow ${tag} ${width}x${height}`);
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.goto(`${BASE}/closet`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.locator("h1").evaluate((el) => {
    el.dataset.r5 = "stay";
  });
  const gridBeforeOpen = page.getByRole("heading", { level: 1 });
  await page.getByRole("button", { name: hero.category, exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 240));
  const tileText = page.getByText(hero.label, { exact: true }).first();
  await tileText.scrollIntoViewIfNeeded();
  const tile = page.getByRole("button", { name: hero.label });
  await tile.waitFor({ timeout: 15000 });
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await openStack(page, hero.label);
  const heading = (await page.locator("[data-hero-heading]").innerText()).replace(/\s+/g, " ");
  if (!heading.includes(hero.name)) {
    throw new Error(`heading "${heading}" does not name ${hero.name}`);
  }
  const urlAtList = new URL(page.url());
  if (urlAtList.pathname !== "/closet" || urlAtList.search) {
    throw new Error(`url changed at the list: ${page.url()}`);
  }

  const topBefore = await scrollList(page);
  const cardsBefore = await page.locator("[data-hero-list] li").allInnerTexts();
  if (cardsBefore.length < 3) throw new Error(`only ${cardsBefore.length} cards`);
  await page.screenshot({ path: shot(`r5-${tag}-a-list`) });

  await page.locator("[data-hero-list] li").nth(2).locator("button").click();
  await page.locator("[data-look-back]").waitFor();
  await assertBackInView(page, width, height);
  const backText = (await page.locator("[data-look-back]").innerText()).replace(/\s+/g, " ");
  if (!/^← Back to \d+ looks?$/.test(backText)) {
    throw new Error(`unexpected Back label: ${backText}`);
  }
  const urlAtLook = new URL(page.url());
  if (urlAtLook.pathname !== "/closet" || urlAtLook.search) {
    throw new Error(`url changed at the look: ${page.url()}`);
  }
  await page.screenshot({ path: shot(`r5-${tag}-b-look`) });

  await page.locator("[data-look-back]").click();
  await page.locator("[data-hero-heading]").waitFor();
  const topAfter = await page.locator("[data-hero-list]").evaluate((el) => el.scrollTop);
  if (Math.abs(topAfter - topBefore) > 1) {
    throw new Error(`scrollTop ${topAfter} vs ${topBefore} at ${tag}`);
  }
  const cardsAfter = await page.locator("[data-hero-list] li").allInnerTexts();
  if (cardsAfter.join("\n") !== cardsBefore.join("\n")) {
    throw new Error(`cards changed after Back at ${tag}`);
  }
  await page.screenshot({ path: shot(`r5-${tag}-c-back`) });

  await page.locator("[data-hero-list] li").nth(2).locator("button").click();
  await page.locator("[data-look-back]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("[data-hero-heading]").waitFor();
  if (await page.locator("[data-look-back]").count()) {
    throw new Error("Esc from the look left Back up");
  }
  const headingAfterEsc = (await page.locator("[data-hero-heading]").innerText()).replace(/\s+/g, " ");
  if (!headingAfterEsc.includes(hero.name)) {
    throw new Error(`heading lost the piece name: ${headingAfterEsc}`);
  }
  await page.screenshot({ path: shot(`r5-${tag}-d-esc`) });

  if (!full) {
    await page.keyboard.press("Escape");
    await page.locator("[data-piece-detail]").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Outfit with this" }).waitFor({ state: "detached" });
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    await page.getByRole("button", { name: "Outfit with this" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Wear this" }).waitFor();
    if (await page.locator("[data-look-back]").count()) {
      throw new Error("outfit path rendered Back");
    }
    await page.screenshot({ path: shot(`r5-${tag}-e-outfit`) });
    await page.keyboard.press("Escape");
    if (await page.locator("[data-piece-detail]").count()) {
      throw new Error("outfit Esc left the piece sheet open");
    }
    return;
  }

  await page.keyboard.press("Escape");
  await page.locator("[data-hero-list]").waitFor({ state: "detached", timeout: 3000 });
  await page.locator("[data-piece-detail]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("[data-piece-detail]").waitFor({ state: "detached", timeout: 3000 });
  if ((await page.locator("h1").getAttribute("data-r5")) !== "stay") {
    throw new Error("ClosetPage remounted");
  }
  const filterClass = await page.getByRole("button", { name: hero.category, exact: true }).getAttribute("class");
  if (!filterClass?.includes("bg-ink")) throw new Error(`filter ${hero.category} did not survive`);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  if (Math.abs(scrollAfter - scrollBefore) > 2) {
    throw new Error(`grid scroll ${scrollAfter} vs ${scrollBefore}`);
  }
  void gridBeforeOpen;

  await openStack(page, hero.label);
  const lengthAtList = await page.evaluate(() => history.length);
  await page.locator("[data-hero-list] li").nth(0).locator("button").click();
  await page.locator("[data-look-back]").waitFor();
  const lengthAtLook = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "More like this" }).click();
  const alts = page.getByRole("dialog").locator("ul.grid button");
  const none = page.getByText("Nothing else in this register.");
  await Promise.race([
    alts.first().waitFor({ timeout: 20000 }),
    none.waitFor({ timeout: 20000 }),
  ]);
  const altCount = await alts.count();
  if (altCount > 0) {
    const beforeAlt = await page.evaluate(() => history.length);
    await alts.first().click();
    await page.locator("[data-look-back]").waitFor();
    const afterAlt = await page.evaluate(() => history.length);
    if (afterAlt !== beforeAlt) {
      throw new Error(`alternate grew history ${beforeAlt} -> ${afterAlt}`);
    }
    await page.locator("[data-look-back]").click();
    await page.locator("[data-hero-heading]").waitFor();
    if (await page.locator("[data-look-back]").count()) {
      throw new Error("Back after an alternate did not return to the list");
    }
  } else {
    console.log("no alternates on the first card; history length check skipped");
  }
  void lengthAtList;
  void lengthAtLook;

  await page.keyboard.press("Escape");
  await page.locator("[data-piece-detail]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("[data-piece-detail]").waitFor({ state: "detached" });

  await page.goBack();
  const left = new URL(page.url());
  if (left.pathname === "/closet") {
    throw new Error("back from a bare /closet stayed on /closet");
  }
  await page.goForward();
  await page.getByRole("heading", { level: 1 }).waitFor();

  await openStack(page, hero.label);
  await scrollList(page);
  await page.locator("[data-hero-list] li").nth(2).locator("button").click();
  await page.locator("[data-look-back]").waitFor();
  const lengthBeforeClose = await page.evaluate(() => history.length);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  if (await page.locator("[data-piece-detail]").count()) throw new Error("Close left the piece sheet");
  if (await page.locator("[data-hero-list]").count()) throw new Error("Close left the list");
  if (await page.locator("[data-look-back]").count()) throw new Error("Close left the look");
  const still = new URL(page.url());
  if (still.pathname !== "/closet") throw new Error(`Close left ${still.pathname}`);
  await page.goBack();
  const afterClose = new URL(page.url());
  if (afterClose.pathname === "/closet") {
    throw new Error(`Close left a history entry (length ${lengthBeforeClose})`);
  }

  await page.goto(`${BASE}/closet`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.getByRole("button", { name: hero.category, exact: true }).click();
  await page.getByText(hero.label, { exact: true }).first().scrollIntoViewIfNeeded();
  await tile.click();
  await page.getByRole("button", { name: "Outfit with this" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Wear this" }).waitFor({ timeout: 30000 });
  if (await page.locator("[data-look-back]").count()) throw new Error("outfit path rendered Back");
  await page.screenshot({ path: shot(`r5-${tag}-e-outfit`) });
  await page.keyboard.press("Escape");
  if (await page.locator("[data-piece-detail]").count()) {
    throw new Error("outfit Esc left the piece sheet open");
  }
  const outfitUrl = new URL(page.url());
  if (outfitUrl.pathname !== "/closet") throw new Error(`outfit Esc left ${outfitUrl.pathname}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const heroPick = pickHero();
  console.log(
    `hero ${heroPick.garment.id} ${heroPick.label} (${heroPick.category}) pieces ${liveSnapshot.length}`,
  );
  const packed = packPersist({
    garments: liveSnapshot,
    looks: [],
    journal: [],
    avoid: {},
    drop: null,
    refPhoto: null,
    refPhotoBackup: null,
    messages: [],
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript((raw) => {
    localStorage.setItem("closet.v6", raw);
  }, packed);
  const hero = {
    label: heroPick.label,
    category: heroPick.category,
    name: heroPick.garment.name,
  };
  try {
    await flow(page, 1280, 800, "1280", hero, true);
    await flow(page, 375, 812, "375", hero, false);
    await flow(page, 390, 844, "390", hero, false);
  } catch (err) {
    await page.screenshot({ path: shot("r5-failure") }).catch(() => {});
    console.error(errors.slice(0, 8).join("\n"));
    throw err;
  } finally {
    await browser.close();
  }
  if (errors.length) console.log(`page errors: ${errors.length}`);
  console.log("shots ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
