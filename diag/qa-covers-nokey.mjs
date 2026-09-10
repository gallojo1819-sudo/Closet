// QA: with NO XAI_API_KEY, a webpage is rejected (not framed) while a phone
// photo still floats on paper. Run against the keyless dev server on :8081.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8081";
let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => fail("page error: " + e.message));

await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
if (!/Set XAI_API_KEY for catalog covers/i.test(await page.textContent("body")))
  fail("no-key banner missing");
else ok("no-key banner shown");

await page.locator("input[type=file][multiple]").setInputFiles([
  "diag/page-farfetch.png",
  "diag/khaki-floor.png",
]);
await page.waitForSelector("text=1 in the closet", { timeout: 120000 });
await page.waitForTimeout(800);

const body = await page.textContent("body");
if (!/that’s a webpage/i.test(body)) fail("page not rejected with copy");
else ok("webpage rejected, not framed");

const garments = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.map((g) => ({ name: g.name, category: g.category, source: g.imageSource }));
});
console.log(JSON.stringify(garments));
if (garments.length !== 1) fail(`expected 1 garment, got ${garments.length}`);
else if (garments[0].category !== "bottom") fail(`phone piece wrong: ${garments[0].name}`);
else ok(`phone photo still floats (${garments[0].name}, ${garments[0].source})`);

await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
