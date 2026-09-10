// Synthesize 2 catalog-style product shots (white/grey studio bg).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const shots = await page.evaluate(() => {
  const W = 900;
  const H = 1125;
  const out = {};

  // 1. navy sweater on pure white
  {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#31405e";
    ctx.fillRect(310, 280, 280, 500); // torso
    ctx.fillRect(200, 300, 110, 360); // sleeves
    ctx.fillRect(590, 300, 110, 360);
    ctx.fillStyle = "#283550";
    ctx.fillRect(410, 260, 80, 30); // collar
    ctx.fillStyle = "rgba(0,0,0,0.06)"; // soft shadow
    ctx.fillRect(200, 790, 500, 14);
    out["prod-sweater.png"] = c.toDataURL("image/png");
  }

  // 2. brown loafers on light grey — a standing pair, clearly shoes
  {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, W, H);
    const shoe = (cx) => {
      // sole
      ctx.fillStyle = "#3f2a18";
      ctx.beginPath();
      ctx.ellipse(cx, 640, 95, 260, 0, 0, Math.PI * 2);
      ctx.fill();
      // leather upper
      ctx.fillStyle = "#6b4a2e";
      ctx.beginPath();
      ctx.ellipse(cx, 600, 88, 240, 0, 0, Math.PI * 2);
      ctx.fill();
      // vamp strap
      ctx.fillStyle = "#54371f";
      ctx.fillRect(cx - 80, 520, 160, 34);
      // heel cap
      ctx.fillStyle = "#462d18";
      ctx.beginPath();
      ctx.ellipse(cx, 810, 80, 60, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    shoe(320);
    shoe(580);
    out["prod-loafers.png"] = c.toDataURL("image/png");
  }
  return out;
});

for (const [name, dataUrl] of Object.entries(shots)) {
  writeFileSync("diag/" + name, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote diag/" + name);
}
await browser.close();
