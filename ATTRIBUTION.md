# CI test assets (branch ci-assets)

Non-commercial test fixtures for GitHub Actions parity + static-host runs.
Used only to verify this studio's WASM build against upstream references.
Not a product, not a service, no inference endpoint.

- `edge/` (13 files): SteerTTS Edge INT4 runtime set from the user-supplied
  `steer-tts-edge` archive (archive HEAD acac05e2c2b1cc18b327532e535782b9e823f213,
  config release `steertts-v2-edge`).
- `full/` (19 files): Full v1 INT8 runtime set from the user-supplied `steer-tts`
  archive (archive HEAD 65ec6a637f4bd9d8085e712cd89e69d302a0, config release
  `steertts-v1`). This is the EXACT set the studio ships (WavLM chunks excluded,
  clone-only).
- `full-private/` + `edge/native/*`: provenance copies of native-only files
  (also present under `full/`); scripts use `edge/` + `full/` directly.

IMPORTANT FINDING (2026-11-15 CI): the ungated mirror's int8/model.safetensors
(ml-resources/steer-tts) is INCOMPATIBLE with the pinned engine: scl_create
fails with "missing tensor encoder.layers.0.n_seq.proj.weight". The mirror is
therefore used only for a non-blocking per-run drift record, never as weights.

Licence: code, weights and voices CC BY-NC 4.0 + Whissle terms
(non-commercial use only; no commercial or hosted-inference use).
Upstream code: https://github.com/WhissleAI/steer-tts
(pinned 5008f8e032f69266c3f37788825cfda3112eab55).
NOTE 2026-11-15: edge/front/cmudict.lex is a git-LFS pointer stub (131 B), not the real
lexicon - the parity workflow rebuilds it deterministically in CI from NLTK cmudict via
upstream steertts_edge.edge_front.lexicon.build() before the native run. Do not use the
checked-in bytes directly; gru.npz / front.json.xz / oov_cache.lex are genuine.
