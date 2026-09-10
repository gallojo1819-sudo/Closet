// QA: COVER LAW. Studio mule stays studio + LARGE; Farfetch card -> jeans
// only (no ID); AMI page -> shirt only (no Add to bag); wood-floor chinos ->
// chinos on paper. Covers persist from IDB after reload.
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
  "diag/prod-loafers.png",
  "diag/page-farfetch.png",
  "diag/page-ami.png",
  "diag/khaki-floor.png",
]);
await page.waitForSelector("text=4 in the closet", { timeout: 300000 });

const garments = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.map((g) => ({
    name: g.name, category: g.category, source: g.imageSource, brand: g.brand,
  }));
});
console.log(JSON.stringify(garments, null, 1));

const byName = (re) => garments.find((g) => re.test(g.name));
const chromeName = /farfetch|ssense|add to bag|\bID\b/i;
for (const g of garments) {
  if (chromeName.test(g.name)) fail(`chrome in name: ${g.name}`);
  if (/^(img|dsc|pxl|photo|image|page)[\s._-]?\d/i.test(g.name)) fail(`filename name: ${g.name}`);
}
ok("no chrome / filename names");

const loafers = garments.find((g) => g.source === "official");
if (!loafers) fail("mule not studio/official");
else ok(`studio stays studio (${loafers.name})`);

const jeans = garments.find((g) => g.category === "bottom" && g.source === "cutout");
if (!jeans) fail("farfetch card did not become a bottom via extract");
else ok(`farfetch -> ${jeans.name} (bottom, extracted${jeans.brand ? ", brand: " + jeans.brand : ""})`);

const shirt = garments.find((g) => g.category === "top");
if (!shirt) fail("AMI page did not become a top");
else ok(`ami -> ${shirt.name} (top)`);

if (garments.filter((g) => g.category === "bottom").length < 2)
  fail("wood-floor chinos missing or not bottom");
else ok("khaki-on-oak = bottom");

// Fill law: every saved cover tile is dense, not a stamp. Count non-paper
// pixels in the /add saved-strip images.
const fills = await page.evaluate(async () => {
  const PAPER = [244, 239, 230];
  const imgs = [...document.querySelectorAll("ul.grid img")];
  const out = [];
  for (const img of imgs) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let garment = 0;
    for (let i = 0; i < d.length; i += 4) {
      const dd = Math.max(
        Math.abs(d[i] - PAPER[0]),
        Math.abs(d[i + 1] - PAPER[1]),
        Math.abs(d[i + 2] - PAPER[2]),
      );
      if (dd > 24) garment++;
    }
    out.push(garment / (c.width * c.height));
  }
  return out;
});
console.log("fill fractions:", fills.map((f) => f.toFixed(2)).join(" "));
for (const f of fills) if (f < 0.15) fail(`postage-stamp cover (fill ${f.toFixed(2)})`);
ok("covers fill the page");

// persistence: reload closet, tiles render from IDB
await page.goto(BASE + "/closet", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const tiles = await page.locator("ul li img").count();
let loaded = 0;
for (let i = 0; i < tiles; i++) {
  if (await page.locator("ul li img").nth(i).evaluate((im) => im.naturalWidth > 0)) loaded++;
}
if (loaded < 4) fail(`covers lost after reload (${loaded}/4)`);
else ok("covers persist from IDB after reload");
await page.screenshot({ path: "diag/qa6-closet.png" });

await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
