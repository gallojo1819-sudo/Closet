// Probe printGarment through the real dev server (server fn + fetch path).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://127.0.0.1:8080/add", { waitUntil: "domcontentloaded" });
const b64 = readFileSync("diag/khaki-floor.png").toString("base64");
const result = await page.evaluate(async (b) => {
  const { printGarment, aiStatus } = await import("/src/lib/ai.ts");
  const status = await aiStatus();
  const res = await printGarment({ data: { image: `data:image/png;base64,${b}` } });
  return {
    status,
    ok: res.ok,
    head: res.ok ? res.image.slice(0, 60) : res.error,
  };
}, b64).catch((e) => ({ error: String(e).slice(0, 300) }));
console.log(JSON.stringify(result, null, 1));
await browser.close();
