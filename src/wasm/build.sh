#!/usr/bin/env bash
# Reproducible baseline WASM build for Speech Control Lab (run in CI or locally with emsdk).
# Pins: emsdk 3.1.68, upstream 5008f8e032f69266c3f37788825cfda3112eab55.
# Produces (no weights embedded): dist/steertts-wasm.js + dist/steertts-wasm.wasm + dist/BUILD-MANIFEST.json
set -euo pipefail
UPSTREAM_SHA="${UPSTREAM_SHA:-5008f8e032f69266c3f37788825cfda3112eab55}"
EMSDK_VER="${EMSDK_VER:-3.1.68}"
OUT="${OUT:-dist}"
echo "upstream=$UPSTREAM_SHA emsdk=$EMSDK_VER out=$OUT"
# 1. emsdk activate (CI installs it; local: source emsdk_env.sh first)
# 2. fetch pinned upstream source (shallow, exact SHA)
rm -rf upstream && mkdir upstream
git -C upstream init -q && git -C upstream remote add origin https://github.com/WhissleAI/steer-tts.git
git -C upstream fetch --depth 1 origin "$UPSTREAM_SHA" && git -C upstream checkout "$UPSTREAM_SHA"
# 3. apply Emscripten file-loader branch (see patches/README.md; patch file maintained next to this script)
#    patch -p1 -d upstream < patches/emscripten-memfs.patch
# 4. compile: all c/src/*.c + c/src/front/*.c with the bridge
mkdir -p "$OUT"
emcc -O2 -std=c11 -ffp-contract=off -fno-fast-math -Wall -Werror \
  -Iupstream/c/include \
  upstream/c/src/*.c upstream/c/src/front/*.c \
  /workspace/src/wasm/scl_bridge.c \
  -o "$OUT/steertts-wasm.js" \
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME=createSteerTTS \
  -s ENVIRONMENT=worker -s SINGLE_FILE=0 \
  -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=64MB -s MAXIMUM_MEMORY=1024MB \
  -s EXPORTED_FUNCTIONS='["_scl_version","_scl_create","_scl_destroy","_scl_synthesize_json","_scl_free_wav","_scl_has","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["FS","HEAPU8","HEAPF32","cwrap","getValue","UTF8ToString"]' \
  -s ENVIRONMENT=node,worker -s STRICT=1 -s NODEJS_CATCH_EXIT=0
cat > "$OUT/BUILD-MANIFEST.json" <<EOF
{"bridge":"scl-bridge-0.1.0","upstream":"$UPSTREAM_SHA","emsdk":"$EMSDK_VER","flags":"-O2 -ffp-contract=off scalar single-thread MEMFS","simd":false,"threads":false}
EOF
node /workspace/src/tools/wasm-build/smoke-test.mjs "$OUT/steertts-wasm.js"
echo OK
