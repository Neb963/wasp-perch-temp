// Speech Control Lab — Emscripten ABI bridge over upstream libsteertts.
// Single-threaded baseline. Staging: JS writes validated model bytes into
// Emscripten MEMFS (/model/...) then calls scl_create("/model").
// No weights are embedded. No pthreads. No -ffast-math (parity: -ffp-contract=off).
//
// Build: see ../tools/wasm-build/README.md + build.sh (emsdk 3.1.68).
// Upstream: https://github.com/WhissleAI/steer-tts @ 5008f8e032f69266c3f37788825cfda3112eab55

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
// Director is independent of the engine (edge's director.bin, ~0.5 MB).
static steertts_director *g_dir = 0;

EMSCRIPTEN_KEEPALIVE
const char *scl_version(void) {
  // steertts_version() is upstream's own version string; suffix ours.
  static char buf[256];
  const char *v = steertts_version();
  snprintf(buf, sizeof buf, "scl-bridge-0.3.0+libsteertts-%s single-thread scalar MEMFS", v ? v : "?");
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

// ---- 0.3.0: prompt mapping, request resolve, director, speaker vector ----

// Free a NUL-terminated JSON string returned by scl_map_prompt /
// scl_resolve_json / scl_director_plan_json (allocated by libsteertts).
EMSCRIPTEN_KEEPALIVE
void scl_free_str(char *s) { if (s) steertts_free(s); }

// v1: free-text prompt -> {"tag":.., "ctrl":{..}, "top_tags":[[tag,p],..]}.
// Needs the MiniLM helper (loaded lazily from the staged native/ assets).
EMSCRIPTEN_KEEPALIVE
int scl_map_prompt(const char *prompt, char **json_out, char *err, int err_len) {
  if (!g_eng) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "no engine: call scl_create first");
    return -1;
  }
  if (!prompt || !json_out) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "null argument");
    return -2;
  }
  *json_out = 0;
  char *out = 0;
  int rc = steertts_map_prompt(g_eng, prompt, &out, err, (size_t)err_len);
  if (rc != 0) return rc;
  *json_out = out;
  return 0;
}

// Fully resolved request (defaults filled, prompt mapped, prompt_mapping
// recorded), as Python's SteerTTS.resolve. Validates like synthesis does.
EMSCRIPTEN_KEEPALIVE
int scl_resolve_json(const char *req_json, char **json_out, char *err, int err_len) {
  if (!g_eng) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "no engine: call scl_create first");
    return -1;
  }
  if (!req_json || !json_out) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "null argument");
    return -2;
  }
  *json_out = 0;
  char *out = 0;
  int rc = steertts_resolve_json(g_eng, req_json, &out, err, (size_t)err_len);
  if (rc != 0) return rc;
  *json_out = out;
  return 0;
}

EMSCRIPTEN_KEEPALIVE
int scl_has(const char *cap) { return steertts_has(g_eng, cap); }

// ---- director (independent of the engine) ----

EMSCRIPTEN_KEEPALIVE
int scl_director_load(char *err, int err_len) {
  if (g_dir) { steertts_director_free(g_dir); g_dir = 0; }
  g_dir = steertts_director_load("/model/director.bin", err, (size_t)err_len);
  return g_dir ? 0 : -1;
}

EMSCRIPTEN_KEEPALIVE
void scl_director_free(void) {
  if (g_dir) { steertts_director_free(g_dir); g_dir = 0; }
}

// 0 = no music support (formats 1/2); >0 = mood count; -1 = no director.
EMSCRIPTEN_KEEPALIVE
int scl_director_moods(void) {
  if (!g_dir) return -1;
  return steertts_director_moods(g_dir);
}

// Minimal strict parser for the studio's sentence list:
// [{"text":"...","dialogue":0}, ...]  (max 256 sentences, 8 KiB text each).
// Handles \" \\ \/ \b \f \n \r \t escapes; other bytes pass through (UTF-8).
static int parse_sentences(const char *js, char ***out_texts, int **out_dlg, int *out_n,
                           char *err, int err_len) {
  int cap = 16, n = 0;
  char **texts = (char **)malloc(sizeof(char *) * (size_t)cap);
  int *dlg = (int *)malloc(sizeof(int) * (size_t)cap);
  if (!texts || !dlg) { free(texts); free(dlg); return -1; }
  const char *p = js;
  while (*p && *p != '[') p++;
  if (!*p) goto fail;
  p++;
  for (;;) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r' || *p == ',') p++;
    if (*p == ']') { p++; break; }
    if (*p != '{') goto fail;
    p++;
    char *text = 0;
    int d = 0, have_text = 0;
    for (;;) {
      while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r' || *p == ',') p++;
      if (*p == '}') { p++; break; }
      if (*p != '"') goto fail_obj;
      p++;
      // key
      char key[32]; int ki = 0;
      while (*p && *p != '"') { if (ki < 31) key[ki++] = *p; p++; }
      key[ki] = 0;
      if (!*p) goto fail_obj;
      p++;
      while (*p == ' ' || *p == '\t') p++;
      if (*p != ':') goto fail_obj;
      p++;
      while (*p == ' ' || *p == '\t') p++;
      if (!strcmp(key, "text")) {
        if (*p != '"') goto fail_obj;
        p++;
        size_t tc = 256, tn = 0;
        char *tb = (char *)malloc(tc);
        if (!tb) goto fail_obj;
        while (*p && *p != '"') {
          char ch = *p;
          if (ch == '\\') {
            p++;
            char e = *p;
            if (!e) { free(tb); goto fail_obj; }
            if (e == 'n') ch = '\n';
            else if (e == 't') ch = '\t';
            else if (e == 'r') ch = '\r';
            else if (e == 'b') ch = '\b';
            else if (e == 'f') ch = '\f';
            else ch = e; // \" \\ \/ and anything else: literal char
            p++;
          } else {
            p++;
          }
          if (tn + 1 >= tc) {
            if (tc >= 8192) { free(tb); goto fail_obj; }
            tc *= 2;
            char *nb = (char *)realloc(tb, tc);
            if (!nb) { free(tb); goto fail_obj; }
            tb = nb;
          }
          tb[tn++] = ch;
        }
        if (!*p) { free(tb); goto fail_obj; }
        p++;
        tb[tn] = 0;
        free(text);
        text = tb;
        have_text = 1;
      } else if (!strcmp(key, "dialogue")) {
        d = (*p == '1') ? 1 : 0;
        while (*p && *p != ',' && *p != '}') p++;
      } else {
        // skip unknown value (string or bare token)
        if (*p == '"') {
          p++;
          while (*p && *p != '"') { if (*p == '\\' && p[1]) p++; p++; }
          if (*p) p++;
        } else {
          while (*p && *p != ',' && *p != '}') p++;
        }
      }
    }
    if (!have_text) goto fail_obj;
    if (n >= 256) { free(text); goto fail_obj; }
    if (n >= cap) {
      cap *= 2;
      char **nt = (char **)realloc(texts, sizeof(char *) * (size_t)cap);
      int *nd = (int *)realloc(dlg, sizeof(int) * (size_t)cap);
      if (!nt || !nd) { free(text); free(nt); free(nd); goto fail; }
      texts = nt;
      dlg = nd;
    }
    texts[n] = text;
    dlg[n] = d;
    n++;
    continue;
  fail_obj:
    free(text);
    goto fail;
  }
  *out_texts = texts;
  *out_dlg = dlg;
  *out_n = n;
  return 0;
fail:
  if (err && err_len > 0) snprintf(err, (size_t)err_len, "scl_director_plan: malformed sentences JSON");
  for (int i = 0; i < n; i++) free(texts[i]);
  free(texts);
  free(dlg);
  return -1;
}

// Plan a whole text at once. sentences_json as above; genre may be ""/NULL.
// Returns malloc'd JSON (free with scl_free_str):
// {"sentences":[{"dims":[6],"pause_ms":N,"ctrl":"rate=..,..."}],"moods":M,"music":[[...]]|null}
EMSCRIPTEN_KEEPALIVE
int scl_director_plan_json(const char *sentences_json, const char *genre, float strength,
                           char **json_out, char *err, int err_len) {
  if (!g_dir) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "no director: call scl_director_load first");
    return -1;
  }
  if (!sentences_json || !json_out) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "null argument");
    return -2;
  }
  *json_out = 0;
  char **texts = 0;
  int *dlgs = 0, n = 0;
  if (parse_sentences(sentences_json, &texts, &dlgs, &n, err, err_len) != 0) return -3;
  if (n == 0) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "no sentences to plan");
    free(texts);
    free(dlg);
    return -4;
  }
  steertts_sentence *ss = (steertts_sentence *)malloc(sizeof(steertts_sentence) * (size_t)n);
  float *plans = (float *)malloc(sizeof(float) * (size_t)n * STEERTTS_PLAN_DIMS);
  if (!ss || !plans) {
    free(ss); free(plans);
    for (int i = 0; i < n; i++) free(texts[i]);
    free(texts); free(dlgs);
    return -5;
  }
  for (int i = 0; i < n; i++) {
    ss[i].text = texts[i];
    ss[i].dialogue = dlgs[i];
    ss[i].has_speaker = dlgs[i];
    ss[i].para_len = n;
    ss[i].para_index = i;
  }
  const char *g = (genre && genre[0]) ? genre : 0;
  int moods = steertts_director_moods(g_dir);
  float *music = 0;
  int rc;
  if (moods > 0) {
    music = (float *)malloc(sizeof(float) * (size_t)n * (size_t)(moods + 2));
    if (!music) rc = -6;
    else rc = steertts_director_plan_music(g_dir, ss, (size_t)n, g, plans, music, err, (size_t)err_len);
  } else {
    rc = steertts_director_plan(g_dir, ss, (size_t)n, g, plans, err, (size_t)err_len);
  }
  char *out = 0;
  if (rc == 0) {
    // ~120 chars/sentence + music rows; grow as needed.
    size_t oc = (size_t)n * (size_t)(140 + (moods > 0 ? (moods + 2) * 12 : 0)) + 64;
    out = (char *)malloc(oc);
    if (!out) rc = -7;
    else {
      size_t o = 0;
      o += (size_t)snprintf(out + o, oc - o, "{\"sentences\":[");
      for (int i = 0; i < n && rc == 0; i++) {
        char ctrl[192];
        if (steertts_plan_ctrl(g_dir, plans + (size_t)i * STEERTTS_PLAN_DIMS, strength, ctrl, sizeof ctrl) != 0) {
          rc = -8;
          break;
        }
        int pause = steertts_plan_pause_ms(plans + (size_t)i * STEERTTS_PLAN_DIMS, 1.0f);
        float *d = plans + (size_t)i * STEERTTS_PLAN_DIMS;
        int w = snprintf(out + o, oc - o,
                         "%s{\"dims\":[%.3f,%.3f,%.3f,%.3f,%.3f,%.3f],\"pause_ms\":%d,\"ctrl\":\"%s\"}",
                         i ? "," : "", d[0], d[1], d[2], d[3], d[4], d[5], pause, ctrl);
        if (w < 0 || (size_t)w >= oc - o) { rc = -9; break; }
        o += (size_t)w;
      }
      if (rc == 0) {
        int w;
        if (moods > 0 && music) {
          w = snprintf(out + o, oc - o, "],\"moods\":%d,\"music\":[", moods);
          if (w < 0 || (size_t)w >= oc - o) rc = -9;
          else {
            o += (size_t)w;
            for (int i = 0; i < n && rc == 0; i++) {
              w = snprintf(out + o, oc - o, "%s[", i ? "," : "");
              if (w < 0 || (size_t)w >= oc - o) { rc = -9; break; }
              o += (size_t)w;
              for (int k = 0; k < moods + 2; k++) {
                w = snprintf(out + o, oc - o, "%s%.4f", k ? "," : "", music[(size_t)i * (size_t)(moods + 2) + (size_t)k]);
                if (w < 0 || (size_t)w >= oc - o) { rc = -9; break; }
                o += (size_t)w;
              }
              w = snprintf(out + o, oc - o, "]");
              if (w < 0 || (size_t)w >= oc - o) { rc = -9; break; }
              o += (size_t)w;
            }
            if (rc == 0) {
              w = snprintf(out + o, oc - o, "]}");
              if (w < 0 || (size_t)w >= oc - o) rc = -9;
              else o += (size_t)w;
            }
          }
        } else {
          w = snprintf(out + o, oc - o, "],\"moods\":%d,\"music\":null}", moods);
          if (w < 0 || (size_t)w >= oc - o) rc = -9;
          else o += (size_t)w;
        }
      }
      if (rc != 0) {
        if (err && err_len > 0) snprintf(err, (size_t)err_len, "scl_director_plan: output overflow");
        free(out);
        out = 0;
      }
    }
  }
  free(music);
  free(ss);
  free(plans);
  for (int i = 0; i < n; i++) free(texts[i]);
  free(texts);
  free(dlgs);
  if (rc == 0) *json_out = out;
  return rc;
}

// ---- speaker vector (v1 cloning; needs staged WavLM, loaded lazily) ----

// 512-d speaker vector of n float samples at sr Hz. out512 must hold 512 floats.
EMSCRIPTEN_KEEPALIVE
int scl_speaker_vector(const float *samples, size_t n, int sr, float *out512,
                       char *err, int err_len) {
  if (!g_eng) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "no engine: call scl_create first");
    return -1;
  }
  if (!samples || !n || !out512) {
    if (err && err_len > 0) snprintf(err, (size_t)err_len, "null argument");
    return -2;
  }
  return steertts_speaker_vector(g_eng, 0, samples, n, sr, out512, err, (size_t)err_len);
}

// Streaming: delivers chunk JSON + PCM via callback into JS (see tts-worker.js).
// Cancellation: return nonzero from the progress callback at chunk boundaries;
// synchronous synthesize cannot be interrupted mid-chunk (studio documents this).
int scl_stream_json(const char *req_json, char *err, int err_len);
