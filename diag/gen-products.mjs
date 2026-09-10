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

  // 2. brown loafers on light grey
  {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#5f4028";
    ctx.beginPath(); // loafer silhouettes, side by side
    ctx.ellipse(340, 560, 130, 220, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(560, 560, 130, 220, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3f2a18";
    ctx.fillRect(250, 420, 180, 26);
    ctx.fillRect(470, 420, 180, 26);
    out["prod-loafers.png"] = c.toDataURL("image/png");
  }
  return out;
});

for (const [name, dataUrl] of Object.entries(shots)) {
  writeFileSync("diag/" + name, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote diag/" + name);
}
await browser.close();
