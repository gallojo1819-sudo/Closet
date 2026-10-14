// QA (local preview only): Today's look is the same on two cold loads, and the stylist dock's
// "This look" is Today's look. Loads / twice seconds apart in fresh contexts that share one
// closet (the sample rack, or a closet.v6 export passed as CLOSET_V6_FILE), diffs the Today
// piece ids, opens the dock and compares its ids with the page's. Writes nothing to the app's
// storage beyond what a normal load does; no network beyond the preview.
//   node diag/qa-today-pin.mjs [http://127.0.0.1:8081]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.PREVIEW_URL ?? "http://127.0.0.1:8081";
const seedFile = process.env.CLOSET_V6_FILE ?? "";
const seed = seedFile ? readFileSync(seedFile, "utf8") : null;
let failures = 0;
const fail = (m) => {
  console.error("FAIL:", m);
  failures += 1;
};
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

async function todayIds(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => fail(`${label}: page error: ${e.message}`));
  if (seed) {
    await page.addInitScript((raw) => {
      if (!localStorage.getItem("closet.v6")) localStorage.setItem("closet.v6", raw);
    }, seed);
  }
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-piece-row]", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const ids = await page.$$eval("[data-piece-row]", (rows) => rows.map((r) => r.getAttribute("data-piece-row")));
  const title = await page.textContent("h2").catch(() => "");
  /* The dock: open it and read Today's ids off the "This look" block. */
  await page.locator("[data-stylist-fab]").click();
  await page.waitForTimeout(400);
  const dock = await page.getAttribute("[data-stylist-today]", "data-garment-ids").catch(() => null);
  const dockText = await page.textContent("[data-stylist-dock]").catch(() => "");
  await context.close();
  return { ids, title: (title ?? "").trim(), dock: dock ? dock.split(",") : null, dockText: dockText ?? "" };
}

const first = await todayIds("load 1");
await new Promise((r) => setTimeout(r, 3000));
const second = await todayIds("load 2");

console.log("load 1:", first.ids.join(","), "|", first.title);
console.log("load 2:", second.ids.join(","), "|", second.title);
if (!first.ids.length) fail("no Today pieces on load 1");
else if (first.ids.join(",") !== second.ids.join(",")) fail("Today differs between two cold loads");
else ok(`Today identical on two loads (${first.ids.length} pieces)`);

const sameSet = (a, b) => a && b && a.length === b.length && [...a].sort().join() === [...b].sort().join();
if (!first.dock) fail(`dock shows no Today look: ${first.dockText.slice(0, 160)}`);
else if (!sameSet(first.dock, first.ids)) fail(`dock ids ${first.dock.join(",")} != page ids ${first.ids.join(",")}`);
else ok("dock's This look === Today's ids");

await browser.close();
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("all ok");
