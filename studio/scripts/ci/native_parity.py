#!/usr/bin/env python3
"""Native upstream parity runner (GitHub Actions, ubuntu, CPU torch).

Loads the PUBLIC upstream code at the pinned SHA plus model weights
(Full INT8 from the ungated ml-resources/steer-tts mirror, Edge runtime
set from this repo's ci-assets branch) and renders the exact same fixed
requests the in-browser harness (src/tests/phase2-parity.js) uses:

  scripts : 3 fixed sentences (identical strings to the browser harness)
  voices  : voice_1688 (full) / voice_1688 + voice_0047 (edge contrast)
  full    : flow default (ON) and flow:false, seed 0, pace 1, guidance 1,
            level auto, default_controls true
  edge    : pace 1, guidance 1, level auto, default_controls true

Also records resolve() JSON, map_prompt("calm gentle greeting") on Full,
and the Edge Director plan for 3 fixed sentences (genre mystery) — the
same inputs the studio sends through RESOLVE / MAP_PROMPT / DIRECTOR_PLAN.

Outputs (into --out):
  native_parity.json  stats + sha256(float32 PCM bytes) per render,
                      resolve dicts, map_prompt result, director dims
  native_edge_*.wav / native_full_*.wav   int16 24kHz renderings

Determinism note: upstream documents bit-for-bit reproducibility on the
SAME device; torch-CPU vs WASM-scalar may differ in the last ulp, so the
compare step uses tolerances (see compare_parity.py) rather than hashes.
"""
import argparse
import hashlib
import json
import shutil
import sys
import wave
from pathlib import Path

import numpy as np

SCRIPTS = [
    "The lantern remained on the windowsill until sunrise.",
    "Mara whispered, but the corridor answered with nothing at all.",
    "Rain over the harbor, gulls, and a bell counting the hour.",
]
MAP_PROMPT = "calm gentle greeting"
DIRECTOR_SENTS = [
    "The hall was silent.",
    '"Mara, come here," she whispered.',
    "The bell counted the hour.",
]


def sha_f32(wav):
    a = np.asarray(wav, dtype=np.float32)
    return hashlib.sha256(a.tobytes()).hexdigest()


def write_wav(path, wav, sr=24000):
    a = np.asarray(wav, dtype=np.float32)
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    rms = float(np.sqrt(np.mean(a * a))) if a.size else 0.0
    pcm16 = (np.clip(a, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm16.tobytes())
    return {"samples": int(a.size), "peak": round(peak, 4),
            "rms": round(rms, 4), "sha256": sha_f32(a)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", required=True, help="upstream checkout @ pinned SHA")
    ap.add_argument("--edge-dir", required=True)
    ap.add_argument("--full-dir", required=True, help="assembled full int8 dir")
    ap.add_argument("--out", required=True)
    ap.add_argument("--mirror-sha", default="")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, f"{args.code}/steertts")
    sys.path.insert(0, f"{args.code}/edge")
    import torch
    torch.set_num_threads(max(1, torch.get_num_threads()))
    try:
        torch.use_deterministic_algorithms(True, warn_only=True)
    except Exception:  # noqa: BLE001 - older torch without warn_only
        pass
    print("torch:", torch.__version__, "threads:", torch.get_num_threads(),
          flush=True)

    from steertts import SteerTTS
    from steertts_edge import EdgeTTS

    print("loading full int8 ...", flush=True)
    full = SteerTTS.from_pretrained(args.full_dir, precision="int8")
    print("loading edge ...", flush=True)
    edge = EdgeTTS(args.edge_dir)

    rec = {"mirror_sha": args.mirror_sha,
           "torch": torch.__version__, "renders": []}

    def run_renders(tts, model, extra, tag):
        for i, text in enumerate(SCRIPTS):
            kw = {"text": text, "pace": 1, "guidance": 1, "level": "auto",
                  "default_controls": True}
            kw.update(extra)
            if model == "full":
                kw.update({"voice": "voice_1688", "seed": 0})
                wav = tts.synthesize(kw)
            else:
                kw.update({"voice": "voice_1688"})
                wav = tts(text, **{k: v for k, v in kw.items() if k != "text"})
            st = write_wav(out / f"native_{tag}_{i}.wav", wav)
            st.update({"model": model, "variant": tag, "chars": len(text)})
            rec["renders"].append(st)
            print(f"{model}/{tag} [{i}] n={st['samples']} "
                  f"peak={st['peak']} rms={st['rms']} sha={st['sha256'][:16]}",
                  flush=True)

    run_renders(full, "full", {}, "flow-on")
    run_renders(full, "full", {"flow": False}, "flow-off")
    run_renders(edge, "edge", {}, "default")

    # resolve() on the same canonical requests the studio sends.
    # NOTE: the python EdgeTTS has no resolve() (normalization lives in
    # the C engine, exercised identically by browser + wasm-node); record
    # that honestly and let compare_parity.py check the C-normalized form.
    edge_req = {"text": SCRIPTS[0], "voice": "voice_1688",
                "pace": 1, "guidance": 1, "level": "auto",
                "default_controls": True}
    rec["resolve"] = {}
    for key, req in {
        "full_flow-on": {"text": SCRIPTS[0], "voice": "voice_1688",
                         "pace": 1, "guidance": 1, "level": "auto",
                         "default_controls": True, "seed": 0},
        "full_flow-off": {"text": SCRIPTS[0], "voice": "voice_1688",
                          "pace": 1, "guidance": 1, "level": "auto",
                          "default_controls": True, "seed": 0,
                          "flow": False},
    }.items():
        rec["resolve"][key] = json.loads(json.dumps(
            full.resolve(dict(req)), default=str))
    try:
        resolve_fn = getattr(edge, "resolve", None)
        if resolve_fn is None:
            raise AttributeError("EdgeTTS has no resolve()")
        rec["resolve"]["edge"] = json.loads(json.dumps(
            resolve_fn(dict(edge_req)), default=str))
    except Exception as e:  # noqa: BLE001
        rec["resolve"]["edge"] = {"unsupported": str(e)[:200],
                                  "request": edge_req}

    # MiniLM prompt mapping (Full only; Edge must fail honestly)
    try:
        mp = full.map_prompt(MAP_PROMPT)
        rec["map_prompt"] = json.loads(json.dumps(mp, default=str))
    except Exception as e:  # noqa: BLE001
        rec["map_prompt"] = {"error": str(e)[:300]}
    try:
        edge_mp = None
        if hasattr(edge, "map_prompt"):
            edge_mp = edge.map_prompt(MAP_PROMPT)
        rec["edge_map_prompt"] = {"unexpected": json.loads(
            json.dumps(edge_mp, default=str))}
    except Exception as e:  # noqa: BLE001
        rec["edge_map_prompt"] = {"error": str(e)[:300]}

    # Director plan (Edge python reference implementation)
    try:
        from steertts_edge.director import Director
        d = Director(args.edge_dir)
        plans = d.plan(list(DIRECTOR_SENTS), genre="mystery")
        dims = []
        for p in plans:
            if isinstance(p, dict) and "dims" in p:
                dims.append([float(x) for x in p["dims"]])
            elif hasattr(p, "dims"):
                dims.append([float(x) for x in p.dims])
            else:
                dims.append(json.loads(json.dumps(p, default=str)))
        rec["director"] = {"n": len(plans), "dims": dims,
                           "ctrl0": d.ctrl(plans[0]) if plans else None,
                           "pause0": Director.pause_ms(plans[0])
                           if plans else None}
    except Exception as e:  # noqa: BLE001
        rec["director"] = {"error": str(e)[:300]}

    (out / "native_parity.json").write_text(json.dumps(rec, indent=1))
    print("wrote", out / "native_parity.json", flush=True)


if __name__ == "__main__":
    main()
