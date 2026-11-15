# CI test assets (branch ci-assets)

Non-commercial test fixtures for GitHub Actions parity + static-host runs.
Used only to verify this studio's WASM build against upstream references.
Not a product, not a service, no inference endpoint.

- `edge/` (13 files): SteerTTS Edge INT4 runtime set from the user-supplied
  `steer-tts-edge` archive (archive HEAD acac05e2c2b1cc18b327532e535782b9e823f213,
  config release `steertts-v2-edge`).
- `full-private/`: Full v1 files NOT present in the ungated mirror
  (native/int8 vocos + minilm, native/front/*, minilm_vocab.txt,
  events.safetensors, request.schema.json) from the user-supplied `steer-tts`
  archive (archive HEAD 65ec6a637f4bd9d8085e712cd89e69d302a0,
  config release `steertts-v1`).
- Full INT8 weights served from the UNGATED mirror
  https://huggingface.co/ml-resources/steer-tts at a recorded revision per
  CI run (config, voices, control_stats, int8/model, int8/flow,
  int8/prompt_adapter, int8/speaker_vectors, int8/pflow).

Licence: code, weights and voices CC BY-NC 4.0 + Whissle terms
(non-commercial use only; no commercial or hosted-inference use).
Upstream code: https://github.com/WhissleAI/steer-tts
(pinned 5008f8e032f69266c3f37788825cfda3112eab55).
