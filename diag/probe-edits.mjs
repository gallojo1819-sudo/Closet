// Probe the xAI images/edits endpoint with the local key. Prints status only.
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const key = env.match(/^XAI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) {
  console.log("no key");
  process.exit(0);
}
const png = readFileSync("diag/khaki-floor.png").toString("base64");
const P = "Catalog product photo of the single garment on warm paper.";

const shapes = [
  ["images 2x url arr", { model: "grok-imagine-image-2.0", images: [{ url: `data:image/png;base64,${png}` }, { url: `data:image/png;base64,${png}` }], prompt: P }],
];
for (const [label, body] of shapes) {
  const res = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(label, "->", res.status, text.slice(0, 160));
  if (res.ok) break;
}
