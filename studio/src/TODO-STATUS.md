# TODO-STATUS — phase ledger (evidence + blockers; binds STUDIO-SPEC IDs)

Conventions: PASS / FAIL / BLOCKED(cause) / NOT TESTED + dated evidence.
No checkbox is ticked without an observed browser result. Full ID coverage lives
in `coverage` handling inside the app (Diagnostics → acceptance export).

## Phase 0 — source, licensing, archive, host feasibility — PASS (2026-11-15, this build)

- 0.1 Licence review — PASS. `LICENSE.md` in both supplied folders = CC BY-NC 4.0 +
  Whissle terms header (`1a42a1bd…`), non-commercial; UI named Speech Control Lab;
  no model assets in public `src/`/CI; event bank CC BY-SA 4.0; helpers MIT/Apache/CC BY-SA 3.0.
  Evidence: `scratch/asset-manifest.json` hashes; `src/THIRD-PARTY-NOTICES.md`; in-app Licences panel.
- 0.2 Archive inventory — PASS. Edge: 12 MB payload verified
  (`acoustic 6645070/aa52b729…`, `vocoder 3862640/9df4ed83…`, `voices 30544/91fdfe0e…`,
  200 voices, 51 tags, `director.bin 516924/54a2abfe…`, `native/front/*` incl. lexicon
  hash `7a493737…` shared with full). Full INT8: `int8/model 9848280/67d1469b…`,
  `int8/flow 17785248/c54a362b…`, `int8/pflow 24878040/83c41912…`,
  `int8/prompt_adapter 503356/b09f25b1…`, `int8/speaker_vectors 1452330/1e5a8de1…`,
  `native/int8/vocos 13628584/9fcdd375…`, `native/int8/minilm 22873628/66fc95f4…`,
  `native/minilm_vocab 231508/07eced37…`, `native/int8/wavlm 114770602` (size only, SHA deferred),
  2825 voices. Evidence: `scratch/asset-manifest.json`.
- 0.3 Upstream pin — PASS. Supplied archives match upstream main
  `5008f8e032f69266c3f37788825cfda3112eab55` (2026-11-03, v1.5.0/edge 2.2.0):
  Edge HEAD `acac05e…`, Full HEAD `65ec6a6…`; config releases `steertts-v2-edge` /
  `steertts-v1`; `steertts.h` API enumerated (create_ex/synthesize_json/stream/resolve/
  has/catalog/map_prompt/director/speaker_vector). Mirror `ml-resources/steer-tts` not
  fetched (gated mirror handling documented in-app; no redistribution assumed).
- 0.4 Host feasibility — PASS. Perchance preview iframe (Chrome 157,
  `crossOriginIsolated=true`, SAB present): empty-WASM `WebAssembly.instantiate`
  OK in page AND in Blob Worker; module Worker + WASM-memory OK; OPFS write/read/delete
  OK; IndexedDB OK; AudioContext 24 kHz creatable (suspended pre-gesture, expected);
  quota ≈2 GB. Evidence: page_eval probe results recorded in `scratch/CURRENT_TASK.md`.
- 0.5 Build route — PASS (decision). No emcc inside Perchance helper → reproducible
  **build-only** GitHub Actions/local recipe (`src/tools/wasm-build/`), pinned
  emsdk 3.1.68 + upstream SHA, single-thread scalar MEMFS baseline
  (`-O2 -ffp-contract=off`, no `-ffast-math`, no `-pthread`), node smoke test
  (instantiate + version, no model). Studio ships the same 3 files under `src/wasm-dist/` and auto-loads them on boot (relative fetch); file-picker fallback remains. Must report matching manifest or stay disabled.
- 0.6 Scaffold — PASS (this delivery). Source-only app + probes; versioned via this file.

Gate 0: SATISFIED. Proceeding to Phase 1 (engine proof) as BLOCKED-until-artifact,
with Phase 3 foundation shipped alongside.

## Phase 1 — Edge C→WASM real speech — PASS (2026-11-15, CI build + in-browser proof)

- Build: reproducible GitHub Actions (repo `Neb963/wasp-perch-temp`, workflow `Build SteerTTS WASM
  (source-only)`, emsdk 3.1.68, upstream `5008f8e0`), bridge `src/wasm/scl_bridge.c` + MEMFS read-fallback
  patch (`src/wasm/patches/emscripten-weights.patch`; Emscripten MEMFS `mmap` traps, read path used instead).
  CI-iterated fixes: `-Iupstream/c/src`, bridge `stdio.h` + `steertts_create`, smoke file:// import, 8 MB stack.
  Smoke OK: `scl-bridge-0.1.0+libsteertts-1.3.0`, no model. Artifacts: js 64 KB + wasm 343 KB + manifest
  (branch `wasm-dist`; copies in `scratch/wasm-dist/`; vendored to `src/wasm-dist/` for auto-load).
- Proof (real Edge weights, browser Worker, scalar WASM): `scl_create` OK after staging model + `native/front/*`.
  Fresh sentence → **71,936 samples = 3.00 s @ 24 kHz, peak 0.72, RMS 0.15, wall 2.4 s → RTF 0.8**.
  Repeat: identical count + SHA-256 (deterministic). Steered request (voice_0047/happiness/ctrls) → 44,800
  different samples. Frame-energy spread confirms speech dynamics. WAVs: `scratch/edge-proof-1.wav`,
  `scratch/edge-proof-3.wav`. Engine load 0.07 s.
- Studio: page-side `INIT_WASM` with same artifacts verified live in preview (manual picker), then bundled auto-load verified live (2026-11-15: pill `scl-bridge-0.1.0+libsteertts-1.3.0 single-thread scalar MEMFS`, status Bundled engine loaded). `INIT_ENGINE`/`SYNTH` use the
  identical cwrap paths; user runs them by importing their local Edge folder → Generate.
1.1 native C reference — NOT TESTED (no native toolchain; WASM-vs-native numeric parity still open).

## Phase 2 — Full INT8 parity — PASS (2026-11-15, bridge 0.3.0)

Supersedes the earlier IN-PROGRESS notes below: Full synthesizes real PCM in-browser
(same 0.3.0 build as Edge; model switch re-inits). Flow-on 71168/75776/75264 RTF ~15;
flow-off identical counts RTF 1.2 (`scratch/phase2-full-flowoff-parity.json`,
`src/tests/phase2-parity.js` with `SCL_FLOW=false`). Gate 2 SATISFIED.

## Phase 3 — studio foundation — IN PROGRESS (shipped scaffold; L1 evidence pending live preview checks this turn)

## Phases 4–8 — NOT TESTED (UI surfaces present; engine-gated actions stay disabled with reasons)

## 2026-11-15 — models bundled + auto-load (this session)

- Edge: src/models/edge/ (13 files, ~13.7 MB) auto-loads on boot. Verified live: 200 voices,
  release steertts-v2-edge, MODEL_READY, Generate enabled, 75264-sample synth at RTF 0.75.
- Full: src/models/full/ (19 files, ~96.6 MB INT8, WavLM excluded as 114 MB > 100 MB/file cap)
  auto-loads on first switch to Full. Verified live: 2825 voices, release steertts-v1 registered.
  BUT INIT_ENGINE is honestly blocked: the bundled src/wasm-dist/ build is still bridge 0.1.0
  (steertts_create defaults to fp32), so it reports cannot open /model/speaker_vectors.safetensors
  plus a rebuild hint. Fix prepared in src/wasm/scl_bridge.c (0.2.0 probes int8/model.safetensors
  and uses create_ex precision=int8); BUILD_EXPECT bumped to scl-bridge-0.2.0.
- Next: re-run the Help rebuild recipe, replace src/wasm-dist/, verify Full synth. Also fixed:
  studio _scl provenance stripped before sending to engine, Full model-switch now triggers initEngine.

## Phase 2 — Full INT8 parity — IN PROGRESS (2.1/2.3/2.4-edge done; 2.2-full blocked on engine rebuild)

2.1 structure validation vs C source (st_api.c + config.json) — DONE 2026-11-15. int8 file map:
precision=int8 sub=int8: dir/int8/model.safetensors (files.acoustic), dir/int8/speaker_vectors.safetensors,
dir/control_stats.json, dir/voices.json, assets=native: int8/vocos.safetensors, int8/minilm.safetensors,
minilm_vocab.txt, front/*, refiner.file=int8/flow.safetensors (flow default ON), pflow lazy (clone path),
prompt_adapter lazy, wavlm lazy (clone only). Bundled 19-file set covers all non-lazy + lazy-except-wavlm.
WavLM (114 MB) excluded: over 100 MB/file cap and clone-only (Phase 6.5 handles missing-WavLM).
Full has no director.bin in supplied archive: Director-for-full BLOCKED (Phase 6.1 scope). Evidence: upstream
st_api.c lines 397-440/700-750, scratch full config dump, 19/19 required fetches OK in preview.
2.3 switch lifecycle — DONE: INIT_ENGINE now wipes /model (rmrf) before staging, MODEL_READY reports
staged files/bytes/ms + measured wasm linear bytes (mem pill live, 64 MB baseline); single-consumer +
generation guard preserved; presets/voices per-model via registerModel; engine.modelId gates Generate.
2.4 Edge baseline — DONE: 3 scripts via src/tests/phase2-parity.js: 71936/76544/76544 samples, RTF ~0.68,
peak 0.72-0.89 RMS ~0.15, sha recorded in scratch/phase2-edge-parity.json. Script-1 count (71936) matches
the Phase-1 proof exactly. Full half runs post-rebuild (same harness + flow:false variant for 2.5).
2.2 Full synth — BLOCKED on engine rebuild (bridge 0.2.0 int8 auto-detect prepared, recipe files at 0.2.0).
2.5 flow on/off is request-level (flow:false supported in schema); tested post-rebuild.

## 2026-11-15 — later phases end-to-end (pack-TODO checkboxes updated w/ evidence)
3.1-3.6 studio foundation PASS: responsive 390/768/1440 + dark verified, manifest/cache/validation,
composer+inspector, WAV RIFF byte-exact export, keyboard traversal (277 focusables).
4.1-4.6 controls PASS (edge): 200-voice catalog ops, 51 tags + 12 ctrls w/ unset-vs-zero + range guards,
pace/guidance/level/gain, markup end-to-end (73856-sample clip w/ pause), word-shift conflict handling,
negative tests (empty/pace/ctrl/voice/mixed-model/corrupt-JSON all rejected w/o clobber). normPath off-by-one fixed.
5.2 edge-lite PASS (whisper/negation/contradiction/unknown + overrides). 5.1/5.3 full-MiniLM BLOCKED (engine).
6.x BLOCKED except honest states: director badge+toast corrected (planning API pending rebuild),
flow toggle request-level ready, clone gated on WavLM+rebuild. 6.6 clone UI hidden for edge (documented).
7.1-7.3 PASS: A/B 2 distinct clips + playback; batch + manifest export; presets save/list/apply/delete.
7.4-7.5 PASS: RTF/wall/staged-ms/wasm-bytes measured; log export redacted (no leaks); coverage honest.
7.6 partial: repeats/switches/corrupt/worker-restart recovery proven; storage-exhaustion + offline NOT TESTED.
8.1/8.3 reviewed (coverage evidence corrected for bundled-weights reality); 8.2 partial (Chromium only);
8.4 partial (edge-demo.wav saved); 8.5 NOT TESTED. Demo: scratch/edge-demo.wav (143916 B).
Still open: Gate 2 (Full synth), 2.4-full, 2.5, 5.1/5.3, 6.x engine parts — all pending bridge-0.2.0 rebuild.

## 2026-11-15 — bridge 0.3.0 wrap-up (supersedes the "still open" line above)

- Engine: `scl-bridge-0.3.0` vendored (`src/wasm-dist/`, js 65378 B / wasm 369969 B),
  pill `0.3.0 factory live`, no manifest warning. Exports: int8 auto-detect,
  map_prompt/resolve/free_str, director load-plan-moods-free, speaker_vector, mini JSON parser.
- Request inspector now has "Validate via engine" (RESOLVE → pretty JSON in `resolvedOut`);
  verified live on Full (resolved request shows profile-applied pace 1.1, default_controls consumed).
- Edge note strengthened: Edge rejects `ref_wav`/`spk_vec` (native error) — cloning is Full-only.
- 2.4-full/2.5: `scratch/phase2-full-flowoff-parity.json` (71168/75776/75264, RTF 1.2).
- 5.1: MAP_PROMPT "calm gentle greeting" → serenity (engine MiniLM), applied to Style panel.
  Edge MAP_PROMPT fails honestly: "prompt= is not available in the edge build…".
- 6.1/6.2: DIRECTOR_LOAD ok (moods 0, no music); DIRECTOR_PLAN 3 sentences (dims/pauses/ctrl);
  UI Plan-only → Generate applied 178632 samples / 3 chunks with provenance.
- 6.5: consent + local decode + STAGE_WAVLM (2×57 MB) + 512-D vector (~15 s) + clone synth
  75264 samples RTF 1.2, spk_vec with voice omitted.
- Remaining-open update 2026-11-15 evening: storage + offline now PASS in-browser (see below);
  Firefox/fresh-profile dropped per user; parity + static-host moved to GitHub Actions CI kit
  in src/tools/ci/ (push blocked: supplied PAT -> 401 Bad credentials); Full director.bin
  confirmed ABSENT UPSTREAM (WhissleAI/steer-tts HF file list + code tree carry director only
  for edge), so 6.1/6.2-full BLOCKED final.

## 2026-11-15 evening - 6.6 closed + storage/offline proven + CI kit ready

 - 6.6 experimental Edge clone IMPLEMENTED + demonstrated: C edge accepts spk_vec (only
   prompt/ref_wav rejected); live proof Full-vector -> Edge synth 77056 samples peak 0.83
   rms 0.17 vs voice_0047 77824 (vector conditions output); ref_wav on Edge fails honestly.
   Studio: vector extracted on Full, usable on Edge (voice omitted, edgeClone provenance flag).
 - Storage failure handling PASS (Diagnostics -> Test storage failure: injected
   QuotaExceededError surfaces via toast+log, cache state unchanged, real OPFS verified working).
   Cache-write path upgraded to toast on real failure too.
 - Offline runtime PASS (Diagnostics -> Test offline runtime: fetch blocked, engine RESOLVE +
   real 14080-sample synth succeed, 0 fetches attempted; post-load runtime is network-free).
 - CI kit in src/tools/ci/: native_parity.py (torch CPU + pinned upstream code + ungated
   mirror weights), wasm_node_parity.mjs (same C engine via Node, mirrors page worker),
   compare_parity.py (tolerances recorded in-file), static_smoke.mjs (Playwright: boot,
   resolve, edge+full synth, map_prompt, director, offline-cut, screenshots), parity.yml +
   static-smoke.yml workflows. Push + dispatch blocked on a working token.
- Remaining NOT TESTED: upstream-C numeric parity (no reference binary), Firefox, fresh
  profile, static host, storage exhaustion, offline. Full has no director.bin (6.1/6.2-full BLOCKED).
