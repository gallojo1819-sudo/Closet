// QA: drawer gains an "On me" tab only once a reference photo is set.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => fail("page error: " + e.message));

await page.goto(BASE + "/add", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("input[type=file][multiple]").setInputFiles(["diag/prod-loafers.png"]);
await page.waitForSelector("text=1 in the closet", { timeout: 300000 });

// no reference yet: drawer must NOT have the tab
await page.goto(BASE + "/closet", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.locator("ul li button").first().click();
await page.waitForTimeout(400);
const drawer = page.locator(".fixed .max-w-3xl");
if (await drawer.getByRole("button", { name: "On me", exact: true }).count())
  fail("On me tab shown without a reference photo");
else ok("On me tab hidden without reference");
await page.getByText("Close", { exact: true }).click();

// set reference photo via TopBar chip
await page.getByRole("button", { name: /Fit · 5′8 reg/ }).click();
await page.waitForTimeout(300);
const chooserPromise = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "Choose photo" }).click();
(await chooserPromise).setFiles("diag/navy-shirt.png");
await page.waitForTimeout(1200);

// reopen drawer: tab appears, clicking it shows the panel
await page.locator("ul li button").first().click();
await page.waitForTimeout(400);
const tab = drawer.getByRole("button", { name: "On me", exact: true });
if (!(await tab.count())) fail("On me tab missing after reference set");
else {
  ok("On me tab appears after reference set");
  await tab.click();
  await page.waitForTimeout(400);
  if (!(await drawer.getByRole("button", { name: /Generate preview|Dressing you/ }).count()))
    fail("On me panel did not render in drawer");
  else ok("drawer On me panel renders");
  if (await drawer.getByText("Use my photo", { exact: false }).count())
    fail("revert button shown on On me view");
  else ok("revert button hidden on On me view");
}

await browser.close();
console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
