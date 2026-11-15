// Static-host smoke test (Playwright, headless Chromium).
// Serves NO Perchance framing: plain HTTP over studio/ with models assembled
// locally. Proves the studio boots, synthesizes Edge+Full, resolves, maps,
// plans, and works with the network cut — outside the preview.
// Usage: PW_DIR=<playwright install> node static_smoke.mjs <studioDir> <outDir>
// (expects the static server already running on :8123; see static-smoke.yml).
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
async function step(page, name, fn) {
  try {
    const d = await fn();
    steps.push({ name, verdict: "PASS", detail: d || "" });
    console.log("PASS " + name + (d ? " :: " + d : ""));
  } catch (e) {
    let log = "";
    try { log = await page.evaluate(() => document.querySelector("#eventLog").textContent.slice(-4000)); } catch (e2) {}
    steps.push({ name, verdict: "FAIL", detail: String((e && e.message) || e).slice(0, 400), logTail: log });
    console.log("FAIL " + name + " :: " + steps[steps.length - 1].detail);
  }
}
// Timer polling (not rAF): headless shells may not fire requestAnimationFrame
// reliably, and several assertions target transient status text.
const wf = (page, fn, timeout, arg) => page.waitForFunction(fn, arg === undefined ? null : arg, { polling: 500, timeout: timeout || 120000 });
const hist = (page) => page.evaluate(() => (S.history[0] ? { n: S.history[0].sampleCount, m: S.history[0].model } : null));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [];
const badResponses = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 300)));
page.on("response", (r) => { if (r.status() >= 400) badResponses.push(r.status() + " " + r.url().slice(-90)); });
// Known-optional probes: the app intentionally fetches these to detect
// optional assets (caught in JS; Chrome still logs the 404 to the console).
const OPTIONAL_404 = [/wavlm_sv\.safetensors$/, /director\.bin$/, /\/flow\.safetensors$/, /\/model\.safetensors$/, /favicon\.ico$/];
const isOptional404 = (s) => OPTIONAL_404.some((re) => re.test(s));

await step(page, "load page", async () => {
  await page.goto("http://localhost:8123/index.html", { waitUntil: "load" });
  return "ok";
});
await step(page, "engine boots (Generate enabled)", async () => {
  await wf(page, () => { const g = document.querySelector("#generateBtn"); return g && !g.disabled; }, 180000);
  const pill = await page.evaluate(() => document.body.textContent.slice(0, 4000));
  if (!/scl-bridge-0\.3\.0/.test(pill)) throw new Error("bridge 0.3.0 pill not found");
  return "scl-bridge-0.3.0 live";
});
await page.screenshot({ path: shots("boot") });
await step(page, "RESOLVE via UI button", async () => {
  await page.click("#resolveBtn");
  await wf(page, () => /"voice"|RESOLVE failed/.test(document.querySelector("#resolvedOut").textContent), 60000);
  const t = await page.evaluate(() => document.querySelector("#resolvedOut").textContent);
  JSON.parse(t);
  if (!/"voice"/.test(t)) throw new Error("resolved request has no voice: " + t.slice(0, 200));
  return "resolved ok";
});
await step(page, "Edge synth (default script)", async () => {
  const before = await hist(page);
  await page.click("#generateBtn");
  const h = await wf(page, (b) => { const x = S.history[0]; return x && (!b || x.sampleCount !== b.n) && x.sampleCount > 50000 ? { n: x.sampleCount, m: x.model } : null; }, 300000, before);
  if (!h || h.m !== "edge") throw new Error("no edge render: " + JSON.stringify(h));
  return h.n + " samples";
});
await page.screenshot({ path: shots("edge-done") });
await step(page, "switch to Full + synth (flow off for speed)", async () => {
  await page.evaluate(() => { document.querySelector("#flowToggle").checked = false; });
  await page.selectOption("#modelSel", "full");
  await wf(page, () => /Engine ready \(full\)/.test(document.querySelector("#genStatus").textContent), 180000);
  const before = await hist(page);
  await page.click("#generateBtn");
  const h = await wf(page, (b) => { const x = S.history[0]; return x && (!b || x.sampleCount !== b.n) && x.sampleCount > 50000 ? { n: x.sampleCount, m: x.model } : null; }, 300000, before);
  if (!h || h.m !== "full") throw new Error("no full render: " + JSON.stringify(h));
  return h.n + " samples";
});
await page.screenshot({ path: shots("full-done") });
await step(page, "MAP_PROMPT via engine (Full)", async () => {
  const r = await page.evaluate(async () => { const m = await workerCall({ type: "MAP_PROMPT", prompt: "calm gentle greeting" }); return m.json; });
  const j = JSON.parse(r);
  if (j.tag !== "serenity") throw new Error("expected serenity, got " + r.slice(0, 200));
  return "serenity";
});
await step(page, "Director plan on Edge (UI path)", async () => {
  await page.selectOption("#modelSel", "edge");
  await wf(page, () => /Engine ready \(edge\)/.test(document.querySelector("#genStatus").textContent), 180000);
  await page.selectOption("#directorGenre", "mystery");
  await page.click("#directorPlanBtn");
  await wf(page, () => /Plan stored|failed/i.test(document.querySelector("#directorOut").textContent), 120000);
  const t = await page.evaluate(() => document.querySelector("#directorOut").textContent);
  if (!/Plan stored/.test(t)) throw new Error(t.slice(0, 200));
  return "plan stored";
});
await step(page, "offline runtime (network cut, resolve+synth)", async () => {
  await ctx.setOffline(true);
  try {
    await page.click("#offlineTestBtn");
    await wf(page, () => /offline runtime (PASS|FAILED)/.test(document.querySelector("#eventLog").textContent), 300000);
    const t = await page.evaluate(() => document.querySelector("#eventLog").textContent.slice(-300));
    if (!/offline runtime PASS/.test(t)) throw new Error(t);
    return "PASS with network cut";
  } finally { await ctx.setOffline(false); }
});
await step(page, "no unexpected console/page/HTTP errors", async () => {
  const real = consoleErrors.filter((s) => !isOptional404(s));
  const realResp = badResponses.filter((s) => !isOptional404(s));
  if (real.length || realResp.length) throw new Error([...real, ...realResp].slice(0, 5).join(" | "));
  return "clean (only known-optional 404 probes)";
});
const verdict = steps.every((s) => s.verdict === "PASS") ? "PASS" : "FAIL";
let fullLog = "";
try { fullLog = await page.evaluate(() => document.querySelector("#eventLog").textContent.slice(-20000)); } catch (e) {}
writeFileSync(`${outDir}/smoke_report.json`, JSON.stringify({ verdict, steps, consoleErrors, badResponses, fullLog }, null, 1));
console.log("verdict:", verdict);
await browser.close();
process.exit(verdict === "PASS" ? 0 : 1);
