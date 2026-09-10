// QA: catalog-print fallback path, names/slots, flat-lay scatter, drawer tabs.
// Runs WITHOUT XAI_API_KEY locally — exercises the flood+guess path.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("dialog", (d) => void d.accept());
page.on("pageerror", (e) => fail("page error: " + e.message));

// ingest 5 mixed (XAI_API_KEY is set in .env.local: banner must stay hidden,
// prints + vision tags are real here)
await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
if (/Set XAI_API_KEY for catalog prints/i.test(await page.textContent("body")))
  fail("banner shown though key is set");
else ok("banner hidden (key set)");
await page.locator("input[type=file][multiple]").setInputFiles([
  "diag/prod-sweater.png",
  "diag/prod-loafers.png",
  "diag/khaki-floor.png",
  "diag/khaki-wall.png",
  "diag/navy-shirt.png",
]);
await page.waitForSelector("text=5 in the closet", { timeout: 300000 });

const garments = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.map((g) => ({ name: g.name, category: g.category, subtype: g.subtype, source: g.imageSource }));
});
console.log(JSON.stringify(garments));
const bottoms = garments.filter((g) => g.category === "bottom");
if (bottoms.length < 2) fail(`khaki shots not bottom: ${JSON.stringify(garments)}`);
else ok(`khaki = bottom (${bottoms.map((b) => b.name).join(" / ")})`);
const shoes = garments.filter((g) => g.category === "footwear");
if (!shoes.length) fail("loafers not footwear");
else ok(`loafers = footwear (${shoes[0].name})`);
for (const g of garments) {
  if (/^(img|dsc|pxl|photo|image)[\s._-]?\d/i.test(g.name)) fail(`filename name: ${g.name}`);
}
ok("no IMG_ names");

// closet grid: no WAITING, no neglected card on a fresh closet
await page.goto(BASE + "/closet", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
if (await page.getByText("Waiting", { exact: true }).count()) fail("WAITING badge on new pieces");
else ok("no WAITING");
if (/Still waiting/.test(await page.textContent("body"))) fail("neglected card on fresh closet");
await page.screenshot({ path: "diag/qa4-closet.png" });

// drawer: Original | Print tabs, category + name edit
await page.locator("ul li button").first().click();
await page.waitForTimeout(500);
const drawer = page.locator(".fixed .max-w-3xl");
if (!(await drawer.getByRole("button", { name: "Print" }).count())) fail("Print tab missing");
if (!(await drawer.getByRole("button", { name: "Original", exact: true }).count())) fail("Original tab missing");
await drawer.getByRole("button", { name: "Original", exact: true }).click();
await page.waitForTimeout(300);
const origVisible = await drawer.locator("img").first().evaluate((i) => i.naturalWidth > 0);
if (!origVisible) fail("original view did not render");
else ok("drawer Original view renders");
await drawer.getByRole("button", { name: "Print", exact: true }).click();
const nameInput = drawer.locator("input[aria-label=Name]");
const oldName = await nameInput.inputValue();
await nameInput.fill("QA rename");
await nameInput.blur();
await page.waitForTimeout(300);
const renamed = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.some((g) => g.name === "QA rename");
});
if (!renamed) fail("name edit did not persist");
else ok(`name edit persists (${oldName} -> QA rename)`);
const catSelect = drawer.locator("select");
await catSelect.selectOption("outerwear");
await page.waitForTimeout(200);
const recat = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  const g = s.state.garments.find((x) => x.name === "QA rename");
  return g?.category;
});
if (recat !== "outerwear") fail(`category edit did not persist (${recat})`);
else ok("category edit persists");
await catSelect.selectOption("bottom"); // tidy up for Today legs check
await page.getByText("Close", { exact: true }).click();

// Today: flat-lay default, scatter on hover, toggles
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const flatCount = await page.locator(".flat-piece").count();
if (!flatCount) fail("flat-lay not default");
else ok(`flat-lay default (${flatCount} pieces)`);
const before = await page.locator(".flat-piece").first().evaluate((el) => getComputedStyle(el).transform);
await page.locator(".flat-piece").first().hover();
await page.locator("div.group").first().hover();
await page.waitForTimeout(900);
const after = await page.locator(".flat-piece").first().evaluate((el) => getComputedStyle(el).transform);
if (before === after) fail("no scatter on hover");
else ok("hover scatters the still-life");
await page.screenshot({ path: "diag/qa4-flatlay.png" });

await page.getByRole("button", { name: "5′8", exact: true }).click();
await page.waitForTimeout(400);
if (!(await page.locator("figure svg").count())) fail("5′8 view missing");
else ok("5′8 fit board");
await page.getByRole("button", { name: "On me", exact: true }).click();
await page.waitForTimeout(400);
if (!/No reference photo yet/i.test(await page.textContent("body"))) fail("on-me view not gated");
else ok("on-me view gated");
await page.getByRole("button", { name: "On paper", exact: true }).click();
await page.waitForTimeout(300);
if (!(await page.locator(".flat-piece").count())) fail("back to paper failed");
else ok("toggle round-trip");

await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
