// Node smoke/parity test for the nano WASM decoder.
// No weights needed: fills all 104 tensors with a deterministic PRNG,
// then checks shape contract, finiteness, determinism, and input sensitivity.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const gluePath = process.argv[2] || "dist/nano-decoder.js";
const mod = await import(pathToFileURL(path.resolve(gluePath)).href);
const factory = mod.default || mod.createNanoDecoder;
if (typeof factory !== "function") throw new Error("no factory export in " + gluePath);
const inst = await factory();
// direct exported-function calls (see repo smoke-test.mjs convention)
const ok = (c, m) => { if (!c) throw new Error("SMOKE-FAIL: " + m); console.log("ok:", m); };

ok(inst._nano_version() === 1, "version==1");
const COUNT = inst._nano_tensor_count();
ok(COUNT === 104, "tensor_count==104 (got " + COUNT + ")");

// deterministic PRNG (mulberry32, float version)
let st = 0x12345678;
const rnd = () => {
  st |= 0; st = (st + 0x6d2b79f5) | 0;
  let t = Math.imul(st ^ (st >>> 15), 1 | st);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const F32 = inst.HEAPF32;
const put = (slot, arr) => {
  const ptr = inst._nano_buf(slot, arr.length);
  ok(ptr !== 0, "buf slot " + slot);
  F32.set(arr, ptr >> 2);
  return ptr;
};

// set all weights with small deterministic values
for (let id = 0; id < COUNT; id++) {
  const len = inst._nano_tensor_len(id);
  ok(len > 0, "len id " + id + " = " + len);
  const a = new Float32Array(len);
  for (let i = 0; i < len; i++) a[i] = (rnd() - 0.5) * 0.2;
  const p = inst._nano_buf(5, len); // scratch slot
  F32.set(a, p >> 2);
  const rc = inst._nano_set_tensor(id, p, len);
  if (rc !== 0) throw new Error("SMOKE-FAIL: set_tensor " + id + " rc=" + rc);
}
ok(inst._nano_weights_ready() === 104, "weights_ready==104");

// bad-id / bad-len rejected
ok(inst._nano_set_tensor(104, 0, 0) === -1, "bad id rejected");

const ta = 4, t = 8, L = t * 300;
const mk = (n, f) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = f(i); return a; };
const asr = mk(512 * ta, (i) => Math.sin(i * 0.01) * 0.1);
const f0 = new Float32Array([90, 100, 110, 105, 95, 0, 0, 80]);
const nz = mk(t, () => 1.5);
const s = mk(128, () => 0.01);
const noiseA = mk(L, (i) => Math.sin(i * 12.9898) * 0.1);
const noiseB = mk(L, (i) => Math.cos(i * 7.233) * 0.1);

put(0, asr); put(1, f0); put(2, nz); put(3, s); put(4, noiseA);
let rc = inst._nano_decode(ta, t, 45.0);
ok(rc === L, "decode returns L=" + L + " (got " + rc + ")");
const outPtr = inst._nano_out_ptr();
ok(outPtr !== 0 && inst._nano_out_len() === L, "out ptr/len");
const outA = F32.slice(outPtr >> 2, (outPtr >> 2) + L);
let finite = true, peak = 0;
for (const v of outA) { if (!Number.isFinite(v)) finite = false; const a = Math.abs(v); if (a > peak) peak = a; }
ok(finite, "output finite");
ok(peak > 1e-6, "output non-trivial (peak=" + peak.toFixed(5) + ")");

// determinism: same inputs again -> bit-identical
put(0, asr); put(1, f0); put(2, nz); put(3, s); put(4, noiseA);
ok(inst._nano_decode(ta, t, 45.0) === L, "second decode L");
const outPtr2 = inst._nano_out_ptr();
const outA2 = F32.slice(outPtr2 >> 2, (outPtr2 >> 2) + L);
let same = outA.length === outA2.length;
for (let i = 0; same && i < outA.length; i++) if (outA[i] !== outA2[i]) same = false;
ok(same, "deterministic across runs");

// sensitivity: different noise -> different output
put(4, noiseB);
ok(inst._nano_decode(ta, t, 45.0) === L, "third decode L");
const outPtr3 = inst._nano_out_ptr();
const outB = F32.slice(outPtr3 >> 2, (outPtr3 >> 2) + L);
let diff = 0;
for (let i = 0; i < L; i++) diff += Math.abs(outB[i] - outA[i]);
ok(diff > 1e-3, "noise-sensitive (meandiff=" + (diff / L).toExponential(2) + ")");

console.log("SMOKE-OK peak=" + peak.toFixed(5));
