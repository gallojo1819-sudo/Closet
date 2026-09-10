// Synthesize two shopping-page screenshots: a Farfetch-style product card
// (jeans, price, FARFETCH ID, color dots) and an AMI-style page (shirt,
// Add to bag). Chrome top and bottom like the real pages.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const shots = await page.evaluate(() => {
  const W = 900;
  const H = 1125;
  const out = {};

  const jeans = (ctx) => {
    // faded blue jeans, two legs
    ctx.fillStyle = "#7d90a8";
    ctx.fillRect(360, 320, 180, 90); // waistband
    ctx.fillRect(350, 400, 90, 420); // left leg
    ctx.fillRect(460, 400, 90, 420); // right leg
    ctx.fillStyle = "#8ea0b6";
    ctx.fillRect(365, 330, 170, 20);
    ctx.fillRect(360, 420, 70, 380);
    ctx.fillRect(470, 420, 70, 380);
    ctx.fillStyle = "#5a6b80";
    ctx.fillRect(360, 320, 180, 10); // waist seam
    ctx.fillRect(448, 400, 6, 420); // inseam shadow
  };

  const shirt = (ctx) => {
    // off-white oxford shirt
    ctx.fillStyle = "#e6e1d4";
    ctx.fillRect(320, 330, 260, 380); // torso
    ctx.fillRect(230, 350, 90, 300); // sleeves
    ctx.fillRect(580, 350, 90, 300);
    ctx.fillStyle = "#d8d2c2";
    ctx.fillRect(430, 320, 40, 30); // collar
    ctx.fillRect(446, 350, 8, 360); // placket
    ctx.fillStyle = "#b9b2a0";
    for (let y = 380; y < 700; y += 52) ctx.fillRect(445, y, 10, 10); // buttons
  };

  const chrome = (ctx, brand, idLine, price) => {
    ctx.fillStyle = "#111111";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(brand, 30, 52);
    ctx.font = "18px sans-serif";
    ctx.fillText("Women  Men  Kids  Sale", 560, 50);
    ctx.fillRect(0, 78, W, 2);
    ctx.font = "20px sans-serif";
    ctx.fillText(idLine, 30, 880);
    ctx.fillText(price, 780, 880);
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 1020, W, 105);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText("Add To Bag", 360, 1082);
  };

  // 1. Farfetch-style card: jeans + ID + price + color dots
  {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    chrome(ctx, "FARFETCH", "Axel Arigato faded jeans · FARFETCH ID: 22334455", "$310");
    jeans(ctx);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ["#7d90a8", "#222222", "#5a6b80", "#c9c2b4"][i];
      ctx.beginPath();
      ctx.arc(40 + i * 34, 950, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    out["page-farfetch.png"] = c.toDataURL("image/png");
  }

  // 2. AMI-style page: shirt + Add to bag
  {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    chrome(ctx, "AMI PARIS", "Oxford shirt · Ref. HSH240", "$240");
    shirt(ctx);
    out["page-ami.png"] = c.toDataURL("image/png");
  }

  return out;
});

for (const [name, dataUrl] of Object.entries(shots)) {
  writeFileSync("diag/" + name, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote diag/" + name);
}
await browser.close();
