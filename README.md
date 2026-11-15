# wasp-perch-temp — source-only WASM build repo

Build-only repo for Speech Control Lab: compiles the pinned upstream SteerTTS C11 engine
(https://github.com/WhissleAI/steer-tts @ 5008f8e032f69266c3f37788825cfda3112eab55) to WebAssembly via
Emscripten 3.1.68. The Actions workflow never handles model weights, audio, tokens, or prompts;
it produces only `steertts-wasm.js` + `steertts-wasm.wasm` + `BUILD-MANIFEST.json`.

Run: Actions → Build SteerTTS WASM (source-only) → Run workflow → download `steertts-wasm-dist`.
