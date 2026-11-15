// Speech Control Lab — Emscripten ABI bridge over upstream libsteertts.
// Single-threaded baseline. Staging: JS writes validated model bytes into
// Emscripten MEMFS (/model/...) then calls scl_create("/model").
// No weights are embedded. No pthreads. No -ffast-math (parity: -ffp-contract=off).
//
// Build: see ../tools/wasm-build/README.md + build.sh (emsdk 3.1.68).
// Upstream: https://github.com/WhissleAI/steer-tts @ 5008f8e032f69266c3f37788825cfda3112eab55
// API surface: c/include/steertts.h (steertts_create_ex, steertts_synthesize_json,
// steertts_stream_json, steertts_resolve_json, steertts_has, voice/tag catalog,
// steertts_map_prompt, steertts_director_*, steertts_speaker_vector, steertts_free).
//
// NOTE: this file is compiled EXTERNALLY (GitHub Actions recipe). It is checked
// in so the port is reviewable; Perchance never compiles it. The studio loads the
// resulting steertts-wasm.js/.wasm supplied by the user at runtime.

#if !defined(__EMSCRIPTEN__)
#error "scl_bridge.c is only compiled with Emscripten (see tools/wasm-build)."
#endif

#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <emscripten.h>
#include "steertts.h"

// Keep one engine at a time (matches studio's single-consumer contract).
static steertts_engine *g_eng = 0;
static char g_model_dir[1024] = {0};

EMSCRIPTEN_KEEPALIVE
const char *scl_version(void) {
  // steertts_version() is upstream's own version string; suffix ours.
  static char buf[256];
  const char *v = steertts_version();
  snprintf(buf, sizeof buf, "scl-bridge-0.2.0+libsteertts-%s single-thread scalar MEMFS", v ? v : "?");
  return buf;
}

EMSCRIPTEN_KEEPALIVE
int scl_create(const char *model_dir, int threads, char *err, int err_len) {
  if (g_eng) { steertts_destroy(g_eng); g_eng = 0; }
  if (!model_dir || !model_dir[0]) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "scl_create: empty model_dir");
    return -1;
  }
  strncpy(g_model_dir, model_dir, sizeof g_model_dir - 1);
  // Single-threaded baseline: 1 worker (= calling thread, no pthreads).
  (void)threads;
  // Precision auto-detect: v1 Full ships packed INT8 under <model_dir>/int8/
  // (config precisions.int8.dir, default "int8"). steertts_create() defaults to
  // fp32, so probe for the INT8 acoustic and use create_ex with precision=int8.
  // Edge ignores precision (always its int4/int8 weights).
  {
    char probe[1152];
    snprintf(probe, sizeof probe, "%s/int8/model.safetensors", model_dir);
    FILE *pf = fopen(probe, "rb");
    if (pf) {
      fclose(pf);
      steertts_config c;
      steertts_default_config(&c);
      c.threads = 1;
      c.precision = "int8";
      g_eng = steertts_create_ex(model_dir, &c, err, (size_t)err_len);
      return g_eng ? 0 : -1;
    }
  }
  g_eng = steertts_create(model_dir, 1, err, (size_t)err_len);
  return g_eng ? 0 : -1;
}

EMSCRIPTEN_KEEPALIVE
void scl_destroy(void) {
  if (g_eng) { steertts_destroy(g_eng); g_eng = 0; }
}

// Synthesize a validated request JSON (built by the studio's request composer).
// Returns 0 on success; out_wav = malloc'd 24kHz float32 (caller copies then
// scl_free_wav), out_n = sample count. Errors in err (truncated).
EMSCRIPTEN_KEEPALIVE
int scl_synthesize_json(const char *req_json, float **out_wav, unsigned *out_n,
                         char *err, int err_len) {
  if (!g_eng) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "no engine: call scl_create first");
    return -1;
  }
  if (!req_json || !out_wav || !out_n) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "null argument");
    return -2;
  }
  *out_wav = 0; *out_n = 0;
  size_t n = 0;
  float *wav = 0;
  int rc = steertts_synthesize_json(g_eng, req_json, &wav, &n, err, err_len);
  if (rc != 0) return rc;
  *out_wav = wav; *out_n = (unsigned)n;
  return 0;
}

EMSCRIPTEN_KEEPALIVE
void scl_free_wav(float *wav) { steertts_free(wav); }

// Streaming: delivers chunk JSON + PCM via callback into JS (see tts-worker.js).
// Cancellation: return nonzero from the progress callback at chunk boundaries;
// synchronous synthesize cannot be interrupted mid-chunk (studio documents this).
EMSCRIPTEN_KEEPALIVE
int scl_stream_json(const char *req_json, char *err, int err_len);

EMSCRIPTEN_KEEPALIVE
int scl_has(const char *cap) { return steertts_has(g_eng, cap); }
