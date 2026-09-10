// QA for FIT board, cost-per-wear, export/import. Dev server on :8080.
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log("ok:", msg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("dialog", (d) => void d.accept());

// 1. Empty closet: Today says empty, no fit toggle.
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const emptyText = await page.textContent("body");
if (!/empty until you photograph it/i.test(emptyText)) fail("empty state copy missing");
else ok("empty closet copy");
if (await page.getByRole("button", { name: /On you · 5′8/ }).count()) fail("fit toggle visible with 0 pieces");
else ok("fit toggle hidden with 0 pieces");

// 2. Load sample rack.
await page.getByRole("button", { name: "Sample rack" }).click();
await page.waitForTimeout(1200);

// 3. Toggle On you / On paper with top+bottom+shoes look.
const fitBtn = page.getByRole("button", { name: /On you · 5′8/ });
const paperBtn = page.getByRole("button", { name: "On paper" });
if (!(await fitBtn.count())) fail("fit toggle missing after sample load");
else ok("fit toggle present");
if (!(await page.locator("figure svg").count())) fail("FitBoard croquis not rendered by default");
else ok("FitBoard default view");
const caption = await page.textContent("body");
if (!/Your photos · Fit 5′8/.test(caption)) fail("FitBoard caption missing");
else ok("FitBoard caption");
if (!(await page.locator("text=5′8").count())) fail("height ticks missing");
else ok("height ticks");
await paperBtn.click();
await page.waitForTimeout(200);
if (await page.locator("figure svg").count()) fail("FitBoard still visible on paper view");
else ok("On paper switches to LookStack");
await fitBtn.click();
await page.waitForTimeout(200);
if (!(await page.locator("figure svg").count())) fail("FitBoard did not come back");
else ok("toggle back to fit");

// 4. CPW: set paid, wear, halves. Grey polo ships with 0 wears.
await page.goto(BASE + "/closet", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.getByRole("button", { name: /Grey polo/ }).click();
await page.waitForTimeout(300);
const paidInput = page.locator("input[type=number]");
await paidInput.fill("100");
await paidInput.blur();
await page.waitForTimeout(300);
let drawer = await page.locator(".fixed .max-w-3xl").textContent();
if (!/first wear \$100/.test(drawer)) fail(`expected "first wear $100", got: ${drawer?.slice(0, 400)}`);
else ok("first wear $100 before any wear");
await page.getByRole("button", { name: "I wore this" }).click();
await page.waitForTimeout(300);
drawer = await page.locator(".fixed .max-w-3xl").textContent();
if (!/cost per wear \$100/.test(drawer)) fail(`expected "cost per wear $100", got: ${drawer?.slice(0, 400)}`);
else ok("cost per wear $100 after 1 wear");
// wear again on a different date via store to halve
await page.evaluate(() => {
  const raw = localStorage.getItem("closet.v6");
  const s = JSON.parse(raw);
  const g = s.state.garments.find((x) => x.paid === 100);
  g.wornOn.push("2020-01-01");
  localStorage.setItem("closet.v6", JSON.stringify(s));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Grey polo/ }).click();
await page.waitForTimeout(300);
drawer = await page.locator(".fixed .max-w-3xl").textContent();
if (!/cost per wear \$50/.test(drawer)) fail(`expected "cost per wear $50", got: ${drawer?.slice(0, 400)}`);
else ok("CPW halves with 2 wears");
await page.getByText("Close", { exact: true }).click();

// 5. Export then import round-trips garments + journal.
const before = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return { garments: s.state.garments.length, journal: s.state.journal.length };
});
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Export" }).click(),
]);
const path = await download.path();
if (download.suggestedFilename() !== "closet-joe.json") fail("export filename wrong");
const payload = JSON.parse(readFileSync(path, "utf8"));
if (payload.v !== 1 || !Array.isArray(payload.garments)) fail("export payload malformed");
else ok(`export payload v=${payload.v} garments=${payload.garments.length}`);
// wipe, then import
await page.evaluate(() => localStorage.removeItem("closet.v6"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.getByRole("button", { name: "Import" }).click(),
]);
await chooser.setFiles(path);
await page.waitForTimeout(800);
const after = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return { garments: s.state.garments.length, journal: s.state.journal.length };
});
if (after.garments !== before.garments || after.journal !== before.journal)
  fail(`round-trip mismatch ${JSON.stringify({ before, after })}`);
else ok(`import round-trip garments=${after.garments} journal=${after.journal}`);

// 6. Outfits: select 2+ pieces shows FitBoard.
await page.goto(BASE + "/outfits", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const tiles = page.locator("section ul li button");
await tiles.nth(0).click();
await tiles.nth(1).click();
await page.waitForTimeout(300);
if (!(await page.locator("section figure svg").count())) fail("FitBoard missing for 2-piece selection");
else ok("outfits compose FitBoard");

// 7. Clear sample rack.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  s.state.garments = s.state.garments.filter((g) => !g.demo);
  localStorage.setItem("closet.v6", JSON.stringify(s));
});
ok("sample cleared");

await browser.close();
console.log(existsSync(path) ? "done" : "done");
process.exit(process.exitCode ?? 0);
