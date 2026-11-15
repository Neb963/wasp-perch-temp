#!/usr/bin/env python3
"""Compare native (torch) vs WASM-node (same C) parity outputs.

PASS thresholds (recorded, not tuned to force green):
  audio   : identical sample counts; max abs diff of int16 PCM <= 2 LSB
            (torch fp32 vs C fp32-scalar may differ in the last ulp)
  resolve : exact dict equality (deterministic JSON->JSON mapping)
  map_prompt : same tag; ctrl values within 1e-3
  director: same sentence count; dims within 1e-4 elementwise
            (upstream numpy port claims bit-match with the C library)

Writes parity_report.json {verdict, checks[]} and exits 1 on FAIL.
"""
import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np


def read_wav16(path):
    with wave.open(str(path), "rb") as w:
        n = w.getnframes()
        assert w.getnchannels() == 1 and w.getsampwidth() == 2
        assert w.getframerate() == 24000
        return np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.int32)


def dict_diff(a, b, prefix=""):
    diffs = []
    for k in sorted(set(a) | set(b)):
        p = f"{prefix}.{k}" if prefix else str(k)
        if k not in a:
            diffs.append(f"{p}: missing in native")
        elif k not in b:
            diffs.append(f"{p}: missing in wasm")
        elif isinstance(a[k], dict) and isinstance(b[k], dict):
            diffs.extend(dict_diff(a[k], b[k], p))
        elif a[k] != b[k]:
            diffs.append(f"{p}: native={a[k]!r} wasm={b[k]!r}")
    return diffs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--native", required=True)
    ap.add_argument("--wasm", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()
    native_dir = Path(args.native)
    wasm_dir = Path(args.wasm)
    nat = json.loads((native_dir / "native_parity.json").read_text())
    wsm = json.loads((wasm_dir / "wasm_parity.json").read_text())

    checks = []

    def check(name, ok, detail):
        checks.append({"name": name, "verdict": "PASS" if ok else "FAIL",
                       "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " :: " + detail,
              flush=True)

    nmap = {(r["model"], r["variant"]): r for r in nat["renders"]}
    wmap = {}
    for r in wsm["renders"]:
        v = r["variant"]
        if v.startswith("full_flow-on"):
            key = ("full", "flow-on")
        elif v.startswith("full_flow-off"):
            key = ("full", "flow-off")
        elif v.startswith("edge_default"):
            key = ("edge", "default")
        else:
            key = ("?", v)
        idx = int(v.rsplit("_", 1)[-1])
        wmap[(key[0], key[1], idx)] = r
    nidx = {}
    for (m, v), r in nmap.items():
        tag = {"flow-on": f"full_flow-on", "flow-off": "full_flow-off",
               "default": "edge_default"}[v]
        nidx[(m, v)] = [x for x in nat["renders"]
                        if x["model"] == m and x["variant"] == v]

    audio_ok = True
    worst_lsb = 0
    for (m, v), rows in sorted(nidx.items()):
        for i, nr in enumerate(rows):
            wr = wmap.get((m, v, i))
            if wr is None:
                check(f"audio {m}/{v}[{i}]", False, "missing wasm render")
                audio_ok = False
                continue
            if nr["samples"] != wr["samples"]:
                check(f"audio {m}/{v}[{i}]", False,
                      f"count {nr['samples']} vs {wr['samples']}")
                audio_ok = False
                continue
            a = read_wav16(native_dir / f"native_{v}_{i}.wav")
            # native files: native_{flow-on|flow-off|default}_{i}.wav
            b = read_wav16(wasm_dir / f"wasm_{m}_{v}_{i}.wav")
            if len(a) != len(b):
                check(f"audio {m}/{v}[{i}]", False, "wav length mismatch")
                audio_ok = False
                continue
            d = int(np.max(np.abs(a - b))) if len(a) else 0
            worst_lsb = max(worst_lsb, d)
            ok = d <= 2
            audio_ok = audio_ok and ok
            check(f"audio {m}/{v}[{i}]", ok,
                  f"n={nr['samples']} maxdiff={d} LSB "
                  f"native_sha={nr['sha256'][:12]} "
                  f"wasm_sha={wr['sha256'][:12]}")
    check("audio summary", audio_ok,
          f"worst max-abs-diff across renders: {worst_lsb} LSB (<=2 PASS)")

    for key in ["full_flow-on", "full_flow-off", "edge"]:
        a, b = nat["resolve"].get(key), wsm["resolve"].get(key)
        if a is None or b is None:
            check(f"resolve {key}", False, "missing side")
        else:
            d = dict_diff(a, b)
            check(f"resolve {key}", not d,
                  "exact match" if not d else "; ".join(d[:8]))

    na, wa = nat.get("map_prompt"), wsm.get("map_prompt")
    if isinstance(na, dict) and isinstance(wa, dict) and "error" not in na \
            and "error" not in wa:
        tag_ok = na.get("tag") == wa.get("tag")
        ctrl_ok, cmax = True, 0.0
        nc = na.get("ctrl") or {}
        wc = wa.get("ctrl") or {}
        for k in set(nc) | set(wc):
            if k not in nc or k not in wc:
                ctrl_ok = False
            else:
                cmax = max(cmax, abs(float(nc[k]) - float(wc[k])))
        ctrl_ok = ctrl_ok and cmax <= 1e-3
        check("map_prompt tag", tag_ok,
              f"native={na.get('tag')!r} wasm={wa.get('tag')!r}")
        check("map_prompt ctrl", ctrl_ok, f"max abs diff {cmax:.6f}")
    else:
        check("map_prompt", False, f"native={na} wasm={wa}")

    nd, wd = nat.get("director"), wsm.get("director")
    if isinstance(nd, dict) and isinstance(wd, dict) and "dims" in nd \
            and "dims" in wd and nd.get("n") == wd.get("n"):
        dmax = 0.0
        for r1, r2 in zip(nd["dims"], wd["dims"]):
            for x, y in zip(r1, r2):
                dmax = max(dmax, abs(float(x) - float(y)))
        check("director dims", dmax <= 1e-4, f"max abs diff {dmax:.3e}")
        check("director ctrl0", str(nd.get("ctrl0")) == str(wd.get("ctrl0")),
              f"native={nd.get('ctrl0')!r} wasm={wd.get('ctrl0')!r}")
    else:
        check("director", False, f"native={nd} wasm={wd}")

    verdict = "PASS" if all(c["verdict"] == "PASS" for c in checks) else "FAIL"
    report = {"verdict": verdict,
              "native_mirror_sha": nat.get("mirror_sha", ""),
              "wasm_bridge": wsm.get("bridge", ""), "checks": checks}
    Path(args.report).write_text(json.dumps(report, indent=1))
    print("verdict:", verdict, flush=True)
    sys.exit(0 if verdict == "PASS" else 1)
