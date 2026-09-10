// QA: Today generates a look from ingested pieces; Wear/Skip work; on-me gating.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("dialog", (d) => void d.accept());
page.on("pageerror", (e) => fail("page error: " + e.message));

// ingest 5 mixed files
await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.locator("input[type=file][multiple]").setInputFiles([
  "diag/prod-sweater.png",
  "diag/prod-loafers.png",
  "diag/khaki-floor.png",
  "diag/khaki-wall.png",
  "diag/navy-shirt.png",
]);
await page.waitForSelector("text=5 in the closet", { timeout: 90000 });
ok("5 ingested");

// Today generates a look from owned pieces
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const dropCount = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.drop?.garmentIds?.length ?? 0;
});
if (!dropCount) fail("no daily drop generated");
else ok(`daily drop generated (${dropCount} pieces)`);
if (!(await page.locator("figure svg").count())) fail("FitBoard missing");
else ok("FitBoard shows the drop");
if (!(await page.getByRole("button", { name: "Wear this" }).count())) fail("Wear button missing");

// Wear it -> logged
await page.getByRole("button", { name: "Wear this" }).click();
await page.waitForTimeout(600);
const worn = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return {
    verdict: s.state.drop?.verdict,
    journal: s.state.journal.length,
    wornTotal: s.state.garments.reduce((n, g) => n + g.wornOn.length, 0),
  };
});
if (worn.verdict !== "worn" || !worn.journal || !worn.wornTotal)
  fail(`wear not logged: ${JSON.stringify(worn)}`);
else ok("Wear logged (journal + wornOn)");

// tiles unchanged: no generated preview overwrote cutouts
const srcs = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.every((g) => g.cutoutSrc.startsWith("idb:"));
});
if (!srcs) fail("cutoutSrc was overwritten");
else ok("cutouts untouched (still his pixels in IDB)");

// on-me gated without reference photo, tiles unchanged after click
await page.getByRole("button", { name: "On me" }).first().click();
await page.waitForTimeout(400);
if (!/No reference photo yet/i.test(await page.textContent("body"))) fail("on-me not gated");
else ok("on me gated without reference photo");

// set a reference photo via the TopBar chip dialog (synthetic full-body shot)
await page.getByRole("button", { name: /Fit · 5′8 reg/ }).click();
await page.waitForTimeout(300);
const chooserPromise = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "Choose photo" }).click();
const chooser = await chooserPromise;
await chooser.setFiles("diag/navy-shirt.png");
await page.waitForTimeout(1200);
const ref = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.refPhoto;
});
if (ref !== "idb:me:ref") fail(`refPhoto not stored: ${ref}`);
else ok("reference photo stored in IDB");

// clicking On me now attempts the call; without XAI key it shows the copy line
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "On me" }).first().click();
await page.waitForTimeout(4000);
const body = await page.textContent("body");
if (!/XAI_API_KEY|Preview failed|missing/i.test(body)) fail("no clear disabled/error copy for on-me");
else ok("on-me without key shows clear copy");
const srcs2 = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.every((g) => g.cutoutSrc.startsWith("idb:"));
});
if (!srcs2) fail("preview attempt overwrote cutouts");
else ok("tiles unchanged after preview attempt");

await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
