// Synthesize a FARFETCH-like shopping-page screenshot: white page, black nav
// chrome top and bottom, product photo in the middle.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const dataUrl = await page.evaluate(() => {
  const W = 900;
  const H = 1125;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // top nav chrome
  ctx.fillStyle = "#111111";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("FARFETCH", 30, 52);
  ctx.font = "18px sans-serif";
  ctx.fillText("Women  Men  Kids  Sale", 560, 50);
  ctx.fillRect(0, 78, W, 2);

  // product: brown mule on white, centered
  ctx.fillStyle = "#5a3a22";
  ctx.beginPath();
  ctx.ellipse(450, 560, 130, 240, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6e4a2c";
  ctx.beginPath();
  ctx.ellipse(450, 520, 118, 210, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3f2716";
  ctx.fillRect(360, 470, 180, 40); // strap

  // caption + price
  ctx.fillStyle = "#111111";
  ctx.font = "20px sans-serif";
  ctx.fillText("Leather mules", 30, 880);
  ctx.fillText("$640", 780, 880);
  ctx.fillStyle = "#888888";
  ctx.font = "16px sans-serif";
  ctx.fillText("Brown · IT 41 · Only 2 left", 30, 908);

  // bottom "add to bag" bar
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 1020, W, 105);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText("Add To Bag", 360, 1082);

  // color dots
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = ["#5a3a22", "#222222", "#8a2e2e", "#c9c2b4"][i];
    ctx.beginPath();
    ctx.arc(40 + i * 34, 970, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  return c.toDataURL("image/png");
});

writeFileSync("diag/shot-farfetch.png", Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("wrote diag/shot-farfetch.png");
await browser.close();
