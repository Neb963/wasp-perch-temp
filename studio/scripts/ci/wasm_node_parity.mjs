// Node parity runner: same C engine (WASM) as the browser, driven from Node.
// Usage: node wasm_node_parity.mjs <distDir> <edgeDir> <fullDir> <outDir>
// Renders the EXACT same request dicts as scripts/ci/native_parity.py and
// src/tests/phase2-parity.js, plus resolve / map_prompt / director plan.
// Mirrors the page worker's staging + cwrap call shapes (see index.html).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const [distDir, edgeDir, fullDir, outDir] = process.argv.slice(2);
if (!distDir || !edgeDir || !fullDir || !outDir) {
  console.error("usage: node wasm_node_parity.mjs <dist> <edge> <full> <out>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const SCRIPTS = [
  "The lantern remained on the windowsill until sunrise.",
  "Mara whispered, but the corridor answered with nothing at all.",
  "Rain over the harbor, gulls, and a bell counting the hour.",
];
const MAP_PROMPT = "calm gentle greeting";
const DIRECTOR_SENTS = [
  { text: "The hall was silent.", dialogue: 0 },
  { text: '"Mara, come here," she whispered.', dialogue: 1 },
  { text: "The bell counted the hour.", dialogue: 0 },
];

const factory = (await import(pathToFileURL(join(distDir, "steertts-wasm.js")).href)).default;
const M = await factory();
console.log("wasm version:", M.UTF8ToString(M._scl_version()));

const C = {
  create: M.cwrap("scl_create", "number", ["number", "number", "number", "number"]),
  synth: M.cwrap("scl_synthesize_json", "number", ["number", "number", "number", "number", "number"]),
  free: M.cwrap("scl_free_wav", null, ["number"]),
  freeStr: M.cwrap("scl_free_str", null, ["number"]),
  mapPrompt: M.cwrap("scl_map_prompt", "number", ["number", "number", "number", "number"]),
  resolve: M.cwrap("scl_resolve_json", "number", ["number", "number", "number", "number"]),
  dirLoad: M.cwrap("scl_director_load", "number", ["number", "number"]),
  dirMoods: M.cwrap("scl_director_moods", "number", []),
  dirPlan: M.cwrap("scl_director_plan_json", "number", ["number", "number", "number", "number", "number", "number"]),
  dirFree: M.cwrap("scl_director_free", null, []),
};
function wStr(s) {
  const b = Buffer.from(s + "\0", "utf8");
  const p = M._malloc(b.length);
  M.HEAPU8.set(b, p);
  return p;
}
function jcall(fn, args) {
  const eP = M._malloc(2048), oP = M._malloc(4);
  let rc = -99, txt = "", em = "";
  try { rc = fn(...args, oP, eP, 2048); } catch (e) { em = String((e && e.message) || e).slice(0, 200); }
  try {
    if (rc === 0) { const p = M.getValue(oP, "i32"); txt = p ? M.UTF8ToString(p) : ""; if (p) C.freeStr(p); }
    else em = M.UTF8ToString(eP) || em || ("rc=" + rc);
  } catch (e) { em = em || String((e && e.message) || e).slice(0, 200); }
  M._free(oP); M._free(eP);
  return { rc, txt, em };
}
function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ rel: relative(dir, p).replace(/\\/g, "/"), buf: readFileSync(p) });
    }
  })(dir);
  return out;
}
function initEngine(modelDir) {
  try { M.FS.stat("/model"); rmrf("/model"); } catch (e) {}
  M.FS.mkdirTree("/model");
  M.FS.mkdirTree("/model/native");
  const t0 = Date.now();
  let bytes = 0;
  for (const f of listFiles(modelDir)) {
    const i = f.rel.lastIndexOf("/");
    if (i > 0) M.FS.mkdirTree("/model/" + f.rel.slice(0, i));
    M.FS.writeFile("/model/" + f.rel, new Uint8Array(f.buf));
    bytes += f.buf.length;
  }
  const d = wStr("/model"), EL = 512, eP = M._malloc(EL);
  const rc = C.create(d, 1, eP, EL);
  const err = rc !== 0 ? M.UTF8ToString(eP) : "";
  M._free(d); M._free(eP);
  if (rc !== 0) throw new Error("scl_create: " + err);
  console.log(`engine ready (${(bytes / 1048576).toFixed(1)} MB staged in ${Date.now() - t0}ms)`);
}
function rmrf(p) {
  try {
    const st = M.FS.stat(p);
    if (M.FS.isDir(st.mode)) {
      for (const e of M.FS.readdir(p)) {
        if (e === "." || e === "..") continue;
        rmrf(p + "/" + e);
      }
      try { M.FS.rmdir(p); } catch (e) {}
    } else { try { M.FS.unlink(p); } catch (e) {} }
  } catch (e) { try { M.FS.unlink(p); } catch (e2) {} }
}
function synth(reqObj) {
  const t0 = Date.now();
  const q = wStr(JSON.stringify(reqObj));
  const outPtr = M._malloc(4), nPtr = M._malloc(4), EL = 2048, eP = M._malloc(EL);
  const rc = C.synth(q, outPtr, nPtr, eP, EL);
  const err = rc !== 0 ? M.UTF8ToString(eP) : "";
  let pcm = null, n = 0;
  if (rc === 0) {
    const wp = M.getValue(outPtr, "i32");
    n = M.getValue(nPtr, "i32");
    pcm = new Float32Array(M.HEAPF32.buffer, wp, n).slice();
    C.free(wp);
  }
  M._free(q); M._free(outPtr); M._free(nPtr); M._free(eP);
  if (rc !== 0) throw new Error("synthesize: " + err);
  return { pcm, wall: (Date.now() - t0) / 1000 };
}
function stats(pcm) {
  let peak = 0, sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
    sum += pcm[i] * pcm[i];
  }
  const h = createHash("sha256");
  h.update(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return { samples: pcm.length, peak: +peak.toFixed(4), rms: +(Math.sqrt(sum / Math.max(1, pcm.length))).toFixed(4), sha256: h.digest("hex") };
}
function writeWav(path, pcm) {
  const n = pcm.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(24000, 24); buf.writeUInt32LE(48000, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? s * 32768 : s * 32767, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

const rec = { bridge: M.UTF8ToString(M._scl_version()), renders: [], resolve: {} };
function fullReq(text, flow) {
  const r = { text, voice: "voice_1688", pace: 1, guidance: 1, level: "auto", default_controls: true, seed: 0 };
  if (flow === false) r.flow = false;
  return r;
}
function edgeReq(text) {
  return { text, voice: "voice_1688", pace: 1, guidance: 1, level: "auto", default_controls: true };
}
function render(tag, req) {
  const { pcm, wall } = synth(req);
  const st = stats(pcm);
  st.chars = req.text.length;
  writeWav(join(outDir, `wasm_${tag}.wav`), pcm);
  rec.renders.push({ variant: tag, ...st, wallSec: +wall.toFixed(2) });
  console.log(`wasm/${tag} n=${st.samples} peak=${st.peak} rms=${st.rms} sha=${st.sha256.slice(0, 16)}`);
}

initEngine(fullDir);
SCRIPTS.forEach((t, i) => render(`full_flow-on_${i}`, fullReq(t, true)));
SCRIPTS.forEach((t, i) => render(`full_flow-off_${i}`, fullReq(t, false)));
for (const [k, r] of Object.entries({
  "full_flow-on": fullReq(SCRIPTS[0], true),
  "full_flow-off": fullReq(SCRIPTS[0], false),
})) {
  const q = wStr(JSON.stringify(r));
  const x = jcall(C.resolve, [q]);
  M._free(q);
  if (x.rc !== 0) throw new Error("resolve failed: " + x.em);
  rec.resolve[k] = JSON.parse(x.txt);
}
{
  const q = wStr(MAP_PROMPT);
  const x = jcall(C.mapPrompt, [q]);
  M._free(q);
  if (x.rc !== 0) rec.map_prompt = { error: x.em };
  else rec.map_prompt = JSON.parse(x.txt);
}
try { C.dirFree(); } catch (e) {}

initEngine(edgeDir);
SCRIPTS.forEach((t, i) => render(`edge_default_${i}`, edgeReq(t)));
{
  const q = wStr(JSON.stringify(edgeReq(SCRIPTS[0])));
  const x = jcall(C.resolve, [q]);
  M._free(q);
  if (x.rc !== 0) throw new Error("edge resolve failed: " + x.em);
  rec.resolve.edge = JSON.parse(x.txt);
}
try {
  const EL = 512, eP = M._malloc(EL);
  const rc = C.dirLoad(eP, EL);
  const em = rc !== 0 ? M.UTF8ToString(eP) : "";
  M._free(eP);
  if (rc !== 0) { rec.director = { error: em }; }
  else {
    rec.director_moods = C.dirMoods();
    const q = wStr(JSON.stringify(DIRECTOR_SENTS));
    const g = wStr("mystery");
    const x = jcall(C.dirPlan, [q, g, 1]);
    M._free(q); M._free(g);
    if (x.rc !== 0) rec.director = { error: x.em };
    else {
      const plan = JSON.parse(x.txt);
      rec.director = {
        n: plan.sentences.length,
        dims: plan.sentences.map((s) => s.dims),
        ctrl0: plan.sentences[0] && plan.sentences[0].ctrl,
        pause0: plan.sentences[0] && plan.sentences[0].pause_ms,
      };
    }
  }
} catch (e) { rec.director = { error: String((e && e.message) || e).slice(0, 300) }; }

writeFileSync(join(outDir, "wasm_parity.json"), JSON.stringify(rec, null, 1));
console.log("wrote wasm_parity.json");
