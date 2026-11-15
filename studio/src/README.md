# Speech Control Lab — src/ home

Browser-only TTS experimentation studio for SteerTTS Edge and SteerTTS full v1 (INT8),
synthesized through the official upstream C11 engine compiled to WebAssembly.
The user-facing name is Speech Control Lab.

- Runtime app: index.html at the workspace root (no build step, no CDN runtime dependency).
  The compiled engine (src/wasm-dist/) and model payloads (src/models/edge/, src/models/full/)
  auto-load on boot via relative fetch. A file-picker fallback remains for browsers without a
  service worker (unsaved preview in some in-app browsers); otherwise save the generator or open
  it in a real browser.
- What lives here (src/): docs, the WASM bridge source + patches, the reproducible build-only
  Emscripten/GitHub-Actions workflow (it never sees weights, audio, or tokens), test/probe scripts,
  the compiled engine under src/wasm-dist/ (code only), and the model payloads under src/models/
  (Edge 13 files ~13 MB; Full INT8 19 files ~96 MB, WavLM excluded as over the 100 MB/file cap).
- What NEVER lives here: API tokens, reference audio, or generated user audio. Extra model folders
  can still be imported at runtime as fallback/override and stay in browser storage (OPFS/IndexedDB).

## Layout

    src/wasm-dist/          bundled Emscripten engine (auto-loaded; bridge 0.2.0 adds INT8 auto-detect)
    src/models/edge/        Edge INT4 payload, auto-loaded on boot (200 voices)
    src/models/full/        Full v1 INT8 payload, auto-loaded on first switch to Full (2825 voices; no WavLM)
    src/wasm/scl_bridge.c   thin Emscripten ABI bridge over upstream libsteertts (single-threaded, MEMFS staging)
    src/tools/wasm-build/   build-only CI recipe + smoke test (no weights/auth/inference)

## Upstream pin

- Upstream repo: https://github.com/WhissleAI/steer-tts, main 5008f8e032f69266c3f37788825cfda3112eab55
  (2026-11-03; steertts 1.5.0 / edge 2.2.0). Emscripten: emsdk 3.1.68 (pinned in workflow + build.sh).
- Rebuild recipe (maintainers): copy src/wasm/scl_bridge.c, src/wasm/build.sh,
  src/tools/wasm-build/github-workflow.yml to .github/workflows/build-wasm.yml, run the workflow,
  replace the 3 files under src/wasm-dist/.

## Licence (short; full terms live with the model folders, not here)

SteerTTS code, weights and voices: CC BY-NC 4.0 + Whissle terms, non-commercial use only.
Recorded event bank: CC BY-SA 4.0. Native helpers keep their own licences
(Vocos MIT, MiniLM Apache-2.0, WavLM CC BY-SA 3.0). Do not run a public hosted inference service
without written permission, and do not market this studio itself under the Whissle/SteerTTS trademarks.