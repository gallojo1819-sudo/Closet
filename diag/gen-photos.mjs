// Synthesize 3 phone-style garment photos for matte/name QA.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const shots = await page.evaluate(() => {
  const W = 900;
  const H = 1200;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return [c, c.getContext("2d")];
  };
  const pants = (ctx, x, y, w, h, fill) => {
    // waistband
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h * 0.09);
    // legs
    const leg = w * 0.42;
    ctx.fillRect(x, y + h * 0.09, leg, h * 0.91);
    ctx.fillRect(x + w - leg, y + h * 0.09, leg, h * 0.91);
    // slight taper shading
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(x + w / 2 - 4, y + h * 0.12, 8, h * 0.85);
  };
  const out = {};

  // 1. khaki pants on wood floor
  {
    const [c, ctx] = mk();
    ctx.fillStyle = "#8a6844";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? "#7d5f3d" : "#93704b";
      ctx.fillRect(0, i * 120, W, 116);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, i * 120 + 116, W, 4);
    }
    // grain streaks
    ctx.fillStyle = "rgba(60,40,20,0.18)";
    for (let i = 0; i < 60; i++) {
      ctx.fillRect(Math.random() * W, Math.random() * H, 2, 30 + Math.random() * 60);
    }
    ctx.save();
    ctx.translate(0, 0);
    pants(ctx, 260, 180, 380, 880, "#b39b6b");
    ctx.restore();
    out["khaki-floor.png"] = c.toDataURL("image/png");
  }

  // 2. khaki pants on cream wall with hanger
  {
    const [c, ctx] = mk();
    ctx.fillStyle = "#efe9dc";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(0, 0, W, 60);
    // hanger hook + bar
    ctx.strokeStyle = "#9a938a";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(450, 120, 34, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(300, 210);
    ctx.lineTo(600, 210);
    ctx.stroke();
    pants(ctx, 280, 220, 340, 830, "#bfa272");
    out["khaki-wall.png"] = c.toDataURL("image/png");
  }

  // 3. navy shirt on grey floor
  {
    const [c, ctx] = mk();
    ctx.fillStyle = "#8f8f8c";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 40, 3);
    ctx.fillStyle = "#2b3a55";
    // torso
    ctx.fillRect(300, 320, 300, 520);
    // sleeves
    ctx.fillRect(190, 340, 110, 320);
    ctx.fillRect(600, 340, 110, 320);
    // collar
    ctx.fillStyle = "#223048";
    ctx.fillRect(410, 300, 80, 30);
    out["navy-shirt.png"] = c.toDataURL("image/png");
  }
  return out;
});

for (const [name, dataUrl] of Object.entries(shots)) {
  writeFileSync("diag/" + name, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote diag/" + name);
}
await browser.close();
