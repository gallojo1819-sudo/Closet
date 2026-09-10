// QA: a shopping-page screenshot must NOT be treated as "official" (which
// would frame the webpage). It should take the grok-edit path -> imageSource
// "cutout", garment-only print, real catalog name.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => fail("page error: " + e.message));

await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("input[type=file][multiple]").setInputFiles([
  "diag/shot-farfetch.png",
]);
await page.waitForSelector("text=1 in the closet", { timeout: 300000 });

const g = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  const x = s.state.garments[0];
  return { name: x.name, category: x.category, source: x.imageSource };
});
console.log(JSON.stringify(g));
if (g.source === "official") fail("screenshot framed as official (webpage kept)");
else ok(`edit path taken (source=${g.source})`);
if (/^(img|dsc|pxl|photo|image|shot)[\s._-]?\d/i.test(g.name)) fail(`filename name: ${g.name}`);
else ok(`name: ${g.name} (${g.category})`);

await page.screenshot({ path: "diag/qa5-screenshot.png" });
await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
