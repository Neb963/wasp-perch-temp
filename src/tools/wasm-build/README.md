# 20-minute WASM build recipe (build-only; inference stays in your browser)

Perchance cannot run the Emscripten compiler, so the C→WASM compile happens
**once**, in a reproducible GitHub Actions job (or on your own machine), and the
studio consumes its two output files. No weights, audio, tokens, or prompts ever
enter CI.

## Option A — GitHub Actions (recommended)

1. Create an empty **private** scratch repo (it will only ever contain source).
2. Copy into it:
   - upstream pin: this recipe (`UPSTREAM_SHA=5008f8e032f69266c3f37788825cfda3112eab55`, `EMSDK_VER=3.1.68`)
   - `src/wasm/scl_bridge.c`, `src/wasm/build.sh`, `src/wasm/patches/README.md`
   - `src/tools/wasm-build/github-workflow.yml` → `.github/workflows/build-wasm.yml`
   - `src/tools/wasm-build/smoke-test.mjs`
3. Push → Actions tab → **Build SteerTTS WASM (source-only)** → Run workflow.
   It checks out upstream at the exact SHA, applies the MEMFS patch, compiles
   with `emcc`, runs the node smoke test (instantiate + `scl_version()`, no
   model), and uploads artifact `steertts-wasm-dist/` containing:
   `steertts-wasm.js`, `steertts-wasm.wasm`, `BUILD-MANIFEST.json`.
4. Download the artifact, then in Speech Control Lab → **Model / Assets →
   Engine (WASM build)** pick the two files. The studio records the manifest
   hash and unlocks **Generate**.

## Option B — local emsdk

```bash
git clone https://github.com/WhissleAI/steer-tts && cd steer-tts
# install emsdk 3.1.68 per https://emscripten.org/docs/getting_started/downloads.html
OUT=/tmp/scl-dist UPSTREAM_SHA=5008f8e032f69266c3f37788825cfda3112eab55 bash /path/to/build.sh
```

## What the studio checks on load

`BUILD-MANIFEST.json` (upstream SHA, emsdk, flags, simd:false/threads:false) is
shown verbatim in Diagnostics → build manifest. `scl_version()` must report the
same upstream version. Until both files are supplied, **Generate stays disabled
with the reason shown** — the studio never synthesizes without this engine and
never fakes it.
