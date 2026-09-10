// QA: mixed ingest (2 product + 2 phone + 1 paste), IDB persistence,
// export/import round-trip, no WAITING, on-me gating. Dev server on :8080.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("dialog", (d) => void d.accept());
page.on("pageerror", (e) => fail("page error: " + e.message));

// 1. Empty state
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
if (!/empty until you photograph it/i.test(await page.textContent("body"))) fail("empty copy missing");
else ok("empty closet copy");
if (await page.getByRole("button", { name: "5′8", exact: true }).count()) fail("view toggle visible with 0 pieces");
else ok("view toggle hidden with 0 pieces");

// 2. 4 files (2 product-white, 2 messy phone)
await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.locator("input[type=file][multiple]").setInputFiles([
  "diag/prod-sweater.png",
  "diag/prod-loafers.png",
  "diag/khaki-floor.png",
  "diag/khaki-wall.png",
]);
await page.waitForSelector("text=4 in the closet", { timeout: 90000 });

// 3. paste a 5th
const b64 = readFileSync("diag/navy-shirt.png").toString("base64");
await page.evaluate((b) => {
  const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const file = new File([bytes], "IMG_0931.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, b64);
await page.waitForSelector("text=5 in the closet", { timeout: 90000 });
ok("5 files processed (4 select + 1 paste)");
if (await page.locator("text=Keep my photo").count()) fail("form present");
else ok("no form");

// 4. Store metadata: idb keys, no data URLs, sources detected
const state = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return {
    bytes: JSON.stringify(s).length,
    garments: s.state.garments.map((g) => ({
      name: g.name, category: g.category, source: g.imageSource,
      o: g.imageSrc.slice(0, 12), c: g.cutoutSrc.slice(0, 12),
      worn: g.wornOn.length, fit: g.fit,
    })),
  };
});
console.log("persist bytes:", state.bytes);
console.table ? console.log(JSON.stringify(state.garments, null, 1)) : null;
if (state.bytes > 200_000) fail(`persist too big: ${state.bytes}`);
else ok("persist is metadata-only");
for (const g of state.garments) {
  if (/^(img|dsc|pxl|photo|image)[\s._-]?\d/i.test(g.name)) fail(`filename name: ${g.name}`);
  if (!g.o.startsWith("idb:") || !g.c.startsWith("idb:")) fail(`not IDB-backed: ${g.name}`);
}
ok("names + idb keys");
const official = state.garments.filter((g) => g.source === "official").length;
const segmented = state.garments.filter((g) => g.source !== "official").length;
if (official !== 2) fail(`expected 2 official, got ${official}`);
else ok(`official x2, phone x${segmented} auto-detected`);

// 5. Refresh: images still render from IDB
await page.goto(BASE + "/closet", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const rendered = await page.evaluate(() =>
  [...document.querySelectorAll("ul li img")].map((i) => i.naturalWidth).filter((w) => w > 0).length,
);
if (rendered < 5) fail(`only ${rendered} images rendered after refresh`);
else ok("images render from IDB after refresh");
if (await page.getByText("Waiting", { exact: true }).count()) fail("WAITING badge on new uploads");
else ok("no WAITING badges");

// 6. Today: flat-lay default, fit board behind the 5′8 toggle, on-me gating
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
if (!(await page.locator(".flat-piece").count())) fail("FlatLay missing on Today");
else ok("FlatLay default on Today");
await page.getByRole("button", { name: "5′8", exact: true }).click();
await page.waitForTimeout(300);
if (!(await page.locator("figure svg").count())) fail("FitBoard missing behind 5′8 toggle");
else ok("FitBoard behind 5′8 toggle");
await page.getByRole("button", { name: "On me", exact: true }).click();
await page.waitForTimeout(400);
if (!/No reference photo yet/i.test(await page.textContent("body"))) fail("on-me gating message missing");
else ok("on me gated without reference photo");

// 7. Export -> wipe (localStorage + IDB) -> import round-trip
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.goto(BASE + "/closet", { waitUntil: "networkidle" }).then(() =>
    page.getByRole("button", { name: "Export" }).click()),
]);
const path = await download.path();
const payload = JSON.parse(readFileSync(path, "utf8"));
if (payload.v !== 2 || !payload.garments.every((g) => g.cutoutSrc.startsWith("data:")))
  fail("export payload lacks images");
else ok(`export v2 with images (${Math.round(readFileSync(path).length / 1024)} KB)`);

await page.evaluate(async () => {
  localStorage.clear();
  const db = await new Promise((res) => {
    const r = indexedDB.open("closet-images", 1);
    r.onsuccess = () => res(r.result);
  });
  await new Promise((res) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").clear();
    tx.oncomplete = res;
  });
});
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
if (!/empty until you photograph it/i.test(await page.textContent("body"))) fail("not empty after wipe");
else ok("wiped clean");

await page.goto(BASE + "/closet", { waitUntil: "networkidle" });
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.getByRole("button", { name: "Import" }).click(),
]);
await chooser.setFiles(path);
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("closet.v6"));
  return s.state.garments.length;
});
if (after !== 5) fail(`import restored ${after}, expected 5`);
else ok("import restored 5 garments");
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const rendered2 = await page.evaluate(() =>
  [...document.querySelectorAll("ul li img")].map((i) => i.naturalWidth).filter((w) => w > 0).length,
);
if (rendered2 < 5) fail(`images broken after import (${rendered2})`);
else ok("images render after import");
await page.screenshot({ path: "diag/qa3-closet.png" });

await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
