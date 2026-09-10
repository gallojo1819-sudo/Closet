// QA for matte + auto-name + waiting fixes. Dev server on :8080.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
let failures = 0;
const fail = (msg) => {
  console.error("FAIL:", msg);
  failures++;
};
const ok = (msg) => console.log("ok:", msg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("dialog", (d) => void d.accept());
page.on("pageerror", (e) => fail("page error: " + e.message));

// 1. Empty closet: Today says empty, fit toggle hidden.
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const emptyText = await page.textContent("body");
if (!/empty until you photograph it/i.test(emptyText)) fail("empty state copy missing");
else ok("empty closet copy");
if (await page.getByRole("button", { name: /On you · 5′8/ }).count()) fail("fit toggle visible with 0 pieces");
else ok("fit toggle hidden with 0 pieces");

// 2. Multi-select 3 photos -> 3 tiles, no form.
await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const input = page.locator("input[type=file][multiple]");
await input.setInputFiles([
  "diag/khaki-floor.png",
  "diag/khaki-wall.png",
  "diag/navy-shirt.png",
]);
await page.waitForSelector("text=in the closet", { timeout: 60000 });
await page.waitForTimeout(1500);
const strip = await page
  .locator("section", { hasText: "in the closet" })
  .locator("ul li")
  .allTextContents();
console.log("strip:", JSON.stringify(strip));
if (strip.length !== 3) fail(`expected 3 tiles, got ${strip.length}`);
else ok("3 tiles from 3 files");
if (await page.locator("text=Keep my photo").count()) fail("form still present");
else ok("no keep form");

// 3. Names + categories in the store.
const garments = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.map((g) => ({
    name: g.name,
    category: g.category,
    colors: g.colors,
    fit: g.fit,
    idle: g.wornOn.length,
    cutout: g.cutoutSrc.slice(0, 30),
  }));
});
console.log("garments:", JSON.stringify(garments, null, 1));
for (const g of garments) {
  if (/^(img|dsc|pxl|photo|image)[\s._-]?\d/i.test(g.name)) fail(`filename name: ${g.name}`);
}
ok("no IMG_* names");
const bottoms = garments.filter((g) => g.category === "bottom");
if (bottoms.length < 2) fail(`expected 2 bottoms (khaki shots), got ${bottoms.length}`);
else ok(`khaki shots tagged bottom: ${bottoms.map((b) => b.name).join(" / ")}`);
const khaki = garments.filter((g) => g.colors.some((c) => /khaki|tan|beige|brown|camel|cream|olive/i.test(c)));
if (!khaki.length) fail("no khaki-ish color detected");
else ok(`colors: ${garments.map((g) => g.colors.join(",")).join(" | ")}`);

// 4. Closet grid: no WAITING on brand-new pieces.
await page.goto(BASE + "/closet", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const waitingBadges = await page.getByText("Waiting", { exact: true }).count();
if (waitingBadges) fail(`${waitingBadges} WAITING badge(s) on new uploads`);
else ok("no WAITING badges on new uploads");
await page.screenshot({ path: "diag/qa2-closet.png" });

// 5. Visual: saved strip floats on paper.
await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: "diag/qa2-add.png" });

await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
