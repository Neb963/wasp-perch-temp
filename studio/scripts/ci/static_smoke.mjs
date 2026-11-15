// Static-host smoke test (Playwright, headless Chromium).
// Serves NO Perchance framing: plain http.server over studio/ with models
// assembled locally. Proves the studio boots, synthesizes Edge+Full,
// resolves, plans, and works with the network cut — outside the preview.
// Usage: node static_smoke.mjs <studioDir> <outDir>   (server on :8123 expected)
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
// Playwright lives in a scratch install dir (CI: $PW_DIR, default ./pw)
// because ESM bare imports don't honor NODE_PATH.
const pwDir = process.env.PW_DIR || "pw";
const { chromium } = createRequire(resolve(pwDir, "package.json"))("playwright");

const [studioDir, outDir] = process.argv.slice(2);
if (!studioDir || !outDir) {
  console.error("usage: node static_smoke.mjs <studioDir> <outDir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const shots = (n) => `${outDir}/${n}.png`;
const steps = [];
async function step(name, fn) {
  try { const d = await fn(); steps.push({ name, verdict: "PASS", detail: d || "" }); console.log("PASS " + name + (d ? " :: " + d : "")); }
  catch (e) { steps.push({ name, verdict: "FAIL", detail: String((e && e.message) || e).slice(0, 400) }); console.log("FAIL " + name + " :: " + steps[steps.length - 1].detail); }
}
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 300)));
const logTail = () => page.evaluate(() => document.querySelector("#eventLog").textContent.slice(-600));

await step("load page", async () => {
  await page.goto("http://localhost:8123/index.html", { waitUntil: "load" });
  return page.url();
});
await step("engine boots (Generate enabled)", async () => {
  await page.waitForFunction(() => { const g = document.querySelector("#generateBtn"); return g && !g.disabled; }, null, { timeout: 180000 });
  const pill = await page.evaluate(() => document.body.textContent.slice(0, 4000));
  if (!/scl-bridge-0\.3\.0/.test(pill)) throw new Error("bridge 0.3.0 pill not found");
  return "scl-bridge-0.3.0 live";
});
await page.screenshot({ path: shots("boot") });
await step("RESOLVE via UI button", async () => {
  await page.click("#resolveBtn");
  await page.waitForFunction(() => /"voice"|RESOLVE failed/.test(document.querySelector("#resolvedOut").textContent), null, { timeout: 60000 });
  const t = await page.evaluate(() => document.querySelector("#resolvedOut").textContent);
  JSON.parse(t);
  if (!/"voice"/.test(t)) throw new Error("resolved request has no voice: " + t.slice(0, 200));
  return "resolved ok";
});
await step("Edge synth (default script)", async () => {
  await page.click("#generateBtn");
  await page.waitForFunction(() => /^Done:/.test(document.querySelector("#genStatus").textContent), null, { timeout: 180000 });
  const n = await page.evaluate(() => S.history[0] && S.history[0].sampleCount);
  if (!(n > 50000)) throw new Error("edge samples too few: " + n);
  return n + " samples";
});
await page.screenshot({ path: shots("edge-done") });
await step("switch to Full + synth (flow off for speed)", async () => {
  await page.evaluate(() => { document.querySelector("#flowToggle").checked = false; });
  await page.selectOption("#modelSel", "full");
  await page.waitForFunction(() => /Engine ready \(full\)/.test(document.querySelector("#genStatus").textContent), null, { timeout: 180000 });
  await page.click("#generateBtn");
  await page.waitForFunction(() => /^Done:/.test(document.querySelector("#genStatus").textContent), null, { timeout: 300000 });
  const r = await page.evaluate(() => ({ n: S.history[0].sampleCount, m: S.history[0].model, flow: S.history[0].input.flow }));
  if (!(r.n > 50000) || r.m !== "full") throw new Error(JSON.stringify(r));
  return r.n + " samples, flow=" + r.flow;
});
await page.screenshot({ path: shots("full-done") });
await step("MAP_PROMPT via engine (Full)", async () => {
  const r = await page.evaluate(async () => { const m = await workerCall({ type: "MAP_PROMPT", prompt: "calm gentle greeting" }); return m.json; });
  const j = JSON.parse(r);
  if (j.tag !== "serenity") throw new Error("expected serenity, got " + r.slice(0, 200));
  return "serenity";
});
await step("Director plan on Edge (UI path)", async () => {
  await page.selectOption("#modelSel", "edge");
  await page.waitForFunction(() => /Engine ready \(edge\)/.test(document.querySelector("#genStatus").textContent), null, { timeout: 180000 });
  await page.selectOption("#directorGenre", "mystery");
  await page.click("#directorPlanBtn");
  await page.waitForFunction(() => /Plan stored|failed/i.test(document.querySelector("#directorOut").textContent), null, { timeout: 120000 });
  const t = await page.evaluate(() => document.querySelector("#directorOut").textContent);
  if (!/Plan stored/.test(t)) throw new Error(t.slice(0, 200));
  return "plan stored";
});
await step("offline runtime (network cut, resolve+synth)", async () => {
  await ctx.setOffline(true);
  try {
    await page.click("#offlineTestBtn");
    await page.waitForFunction(() => /offline runtime (PASS|FAILED)/.test(document.querySelector("#eventLog").textContent), null, { timeout: 300000 });
    const t = await logTail();
    if (!/offline runtime PASS/.test(t)) throw new Error(t.slice(-300));
    return "PASS with network cut";
  } finally { await ctx.setOffline(false); }
});
await step("no console/page errors", async () => {
  if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 5).join(" | "));
  return "clean";
});
const verdict = steps.every((s) => s.verdict === "PASS") ? "PASS" : "FAIL";
writeFileSync(`${outDir}/smoke_report.json`, JSON.stringify({ verdict, steps, consoleErrors, logTail: await logTail() }, null, 1));
console.log("verdict:", verdict);
await browser.close();
process.exit(verdict === "PASS" ? 0 : 1);
