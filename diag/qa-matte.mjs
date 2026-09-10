import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("crash", () => console.log("[CRASH]"));
await page.goto("http://127.0.0.1:8080/add", { waitUntil: "domcontentloaded" });
const dataUrl = "data:image/png;base64," + readFileSync("diag/khaki-floor.png").toString("base64");
console.log("data url bytes:", dataUrl.length);
const t = await page.evaluate(async (src) => {
  const t0 = performance.now();
  const { matteToPaper } = await import("/src/lib/matte.ts");
  const r = await matteToPaper(src);
  return { ms: Math.round(performance.now() - t0), quality: r.quality, out: r.cutoutSrc.length };
}, dataUrl).catch((e) => ({ error: String(e) }));
console.log(t);
await browser.close();
