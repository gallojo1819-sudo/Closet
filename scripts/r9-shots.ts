/**
 * Fixture screenshots for the jacket sheet and the signed-out photo check.
 * Seeds closet.v6 in the browser only. Aborts Open-Meteo, xAI, and Supabase.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { liveSnapshot } from "../src/lib/__fixtures__/snapshot.ts";
import { packPersist } from "../src/lib/store-persist.ts";
import type { Garment } from "../src/lib/types.ts";

const BASE = process.env.CLOSET_URL ?? "http://127.0.0.1:8080";
const OUT = process.argv[2] ?? "/opt/cursor/artifacts/r9";
const TODAY = "2026-11-06";

function plated(g: Garment): Garment {
  return { ...g, imageSource: "official", cutoutSrc: "shot-plate", imageSrc: "shot-original", reprint: false };
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("shot", name);
}

async function stubWeather(page: Page) {
  await page.route("https://api.open-meteo.com/**", (route) => route.abort());
  await page.route("**/_serverFn/**", (route) => {
    const id = route.request().url().split("/_serverFn/")[1] ?? "";
    let file = "";
    try {
      file = Buffer.from(decodeURIComponent(id), "base64").toString("utf8");
    } catch {
      file = "";
    }
    if (file.includes("weather.ts")) return route.abort();
    return route.continue();
  });
}

async function stableDetector(page: Page) {
  await page.waitForFunction(
    () => document.querySelector("[data-look-count]")?.getAttribute("data-resolved") === "1",
    undefined,
    { timeout: 120000 },
  );
  const detector = page.locator("[data-detector-card]").first();
  await detector.waitFor({ timeout: 60000 });
  let last = "";
  for (let i = 0; i < 8; i += 1) {
    const text = (await detector.textContent({ timeout: 5000 }).catch(() => ""))?.trim() ?? "";
    if (text && text === last) return detector;
    last = text;
    await page.waitForTimeout(400);
  }
  return detector;
}

async function openSheet(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30000 });
  const edit = page.locator("[data-today-edit]");
  await edit.waitFor({ timeout: 20000 });
  await edit.click();
  await page.locator("[data-jacket-edit]").waitFor({ timeout: 15000 });
}

async function flow(page: Page, width: number, tag: string) {
  await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
  await openSheet(page);
  await shot(page, `${tag}-sheet-on`);
  await page.locator("[data-jacket-off]").click();
  await page.getByRole("dialog").locator("[data-weather-warned]").waitFor({ timeout: 10000 });
  await shot(page, `${tag}-sheet-off-warning`);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.locator("[data-today-edit]").waitFor();
  await page.locator("main [data-weather-warned], [data-weather-warned]").first().waitFor({ timeout: 10000 });
  await shot(page, `${tag}-today-warned`);
  await page.locator("[data-today-edit]").click();
  await page.locator("[data-jacket-edit]").waitFor();
  const warning = page.getByRole("dialog").locator("[data-weather-warned]");
  await warning.waitFor({ timeout: 10000 });
  await warning.scrollIntoViewIfNeeded();
  await shot(page, `${tag}-sheet-reopened`);
  await page.locator("[data-jacket-next]").click();
  await page.locator("[data-jacket-on][aria-pressed='true']").waitFor({ timeout: 10000 });
  await shot(page, `${tag}-sheet-another`);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.goto(`${BASE}/lookbook`, { waitUntil: "domcontentloaded" });
  const detector = await stableDetector(page);
  await detector.locator("button").first().click();
  await page.locator("[data-jacket-edit]").waitFor({ timeout: 15000 });
  await page.locator("[data-jacket-off]").click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  const edited = detector.locator("[data-weather-warned]");
  await edited.waitFor({ timeout: 10000 });
  await edited.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await shot(page, `${tag}-detector-edited`);

  await page.goto(`${BASE}/?outfitCheck=picker`, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator("[data-outfit-picker]").waitFor({ timeout: 15000 });
  await shot(page, `${tag}-check-signed-in`);

  await page.goto(`${BASE}/?outfitCheck=signedout`, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator("[data-outfit-check-signed-out]").waitFor({ timeout: 15000 });
  await shot(page, `${tag}-check-signed-out`);
}

async function noAlternative(browser: Awaited<ReturnType<typeof chromium.launch>>, tag: string, width: number) {
  const ids = ["g_gp53xkrmem9b", "g_6xkkzn06sbdm", "g_2djvq6l9qxbb", "g_8qqqzpwxuwti"];
  const garments = liveSnapshot.filter((g) => ids.includes(g.id)).map(plated);
  const packed = packPersist({
    garments,
    looks: [],
    journal: [],
    avoid: {},
    drop: {
      date: TODAY,
      garmentIds: ids,
      worn: false,
      verdict: "pending",
      occasion: "out",
      weather: { f: 64, label: "Mild", code: 2, measured: true, highF: 64 },
    },
    refPhoto: null,
    refPhotoBackup: null,
    messages: [],
  });
  const page = await browser.newPage();
  await stubWeather(page);
  await page.addInitScript((raw) => {
    localStorage.setItem("closet.v6", raw);
  }, packed);
  await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator("[data-today-edit]").click();
  await page.locator("[data-jacket-edit]").waitFor({ timeout: 15000 });
  await page.locator("[data-jacket-next]").click();
  const note = page.locator("[data-jacket-note]");
  await note.waitFor({ timeout: 10000 });
  await note.scrollIntoViewIfNeeded();
  await shot(page, `${tag}-no-alternative`);
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const garments = liveSnapshot.map(plated);
  const packed = packPersist({
    garments,
    looks: [],
    journal: [],
    avoid: {},
    drop: {
      date: TODAY,
      garmentIds: ["g_8qqqzpwxuwti", "g_6lolc7ma0mk8", "g_xi3w7tz3aren", "g_rxglifsoqobm"],
      worn: false,
      verdict: "pending",
      occasion: "weekday",
      weather: { f: 48, label: "Cold", code: 3, measured: true, highF: 48, wet: true },
    },
    refPhoto: null,
    refPhotoBackup: null,
    messages: [],
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await stubWeather(page);
  await page.addInitScript((raw) => {
    localStorage.setItem("closet.v6", raw);
  }, packed);
  try {
    await flow(page, 1280, "1280");
    await flow(page, 375, "375");
    await noAlternative(browser, 1280, 1280);
    await noAlternative(browser, 375, 375);
  } catch (err) {
    await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
    console.error(errors.slice(0, 8).join("\n"));
    throw err;
  } finally {
    await browser.close();
  }
  if (errors.length) console.log("page errors", errors.slice(0, 8));
  console.log("shots ok", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
