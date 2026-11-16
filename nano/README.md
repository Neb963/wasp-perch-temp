# nano WASM decoder

C11 port of the nano-edge-tts decoder (1.75M params), built with Emscripten.
Mirrors the generator's `src/nano.js` exactly: same op order, float32 math,
no fast-math (`-ffp-contract=off -fno-fast-math`).

Reference algorithm: nano-edge-tts `nano_edge_tts.py` (Apache-2.0).

## C ABI (exported)

- `nano_version()` → 1
- `nano_tensor_count()` → 104
- `nano_tensor_len(id)` → expected float count, or -1
- `nano_set_tensor(id, ptr, len)` → 0 ok, -1 bad id, -2 len mismatch, -3 oom
- `nano_weights_ready()` → number of slots set (want 104)
- `nano_buf(slot, n)` → writable float pointer (capacity ≥ n); slots:
  0 asr `[512*Ta]`, 1 f0 `[T]`, 2 n `[T]`, 3 style `[128]`, 4 noise `[L]`
- `nano_decode(ta, t, creak_rate)` → L (`t*300`) or negative on error:
  -1 weights missing, -2 bad dims, -3 buffers missing, -4 mapper oom, -5 renderer oom
- `nano_out_ptr()` / `nano_out_len()` → latest waveform

## Weight order (104 tensors)

0–7 mapper base: `inpW, inpB, headW, headB, mean, std, normW, normB`.
`8 + b*9 + k` mapper block b (0–5), k =
`dwW, dwB, fcW, fcB, upW, upB, dnW, dnB, scale`.
62–67 renderer base: `inpW, inpB, headW, headB, normW, normB`.
`68 + b*9 + k` renderer block b (0–3), same 9 keys.

Same order as the safetensors file; see generator `src/nano-wasm.js`.

## Build

GitHub Actions (`build-nano-wasm.yml`, Emscripten 3.1.68, `-O2` scalar
single-thread, `web,worker,node`, memory growth to 1 GB). Output
`nano-decoder.js` + `nano-decoder.wasm` + `BUILD-MANIFEST.json` lands on the
`nano-wasm-dist` branch and as a workflow artifact.

Local: `emcc -O2 -std=c11 -ffp-contract=off -fno-fast-math -Wall ...`
(see the workflow for the full flag set).
