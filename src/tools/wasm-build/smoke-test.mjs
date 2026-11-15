// Node smoke test for the build-only WASM dist (no model, no inference).
// Usage: node smoke-test.mjs dist/steertts-wasm.js
import { readFile } from "node:fs/promises";
const jsPath = process.argv[2];
if (!jsPath) { console.error("usage: node smoke-test.mjs <steertts-wasm.js>"); process.exit(2); }
const { pathToFileURL } = await import("node:url");
const { resolve } = await import("node:path");
const factory = (await import(pathToFileURL(resolve(jsPath)).href)).default;
const mod = await factory();
const ptr = mod._scl_version();
const ver = mod.UTF8ToString ? mod.UTF8ToString(ptr) : mod.AsciiToString(ptr);
console.log("scl_version:", ver);
if (!/libsteertts-/.test(ver)) { console.error("unexpected version string"); process.exit(1); }
console.log("SMOKE OK (instantiated, no model loaded, no synthesis attempted)");
