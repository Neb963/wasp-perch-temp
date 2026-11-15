# Emscripten patches (minimal, reviewable)

Upstream `c/src/st_weights.c` uses POSIX `open`/`fstat`/`mmap` (and a
read-fallback on Windows). Emscripten has no native OS mappings, so the
reproducible build adds **one small `__EMSCRIPTEN__` branch** (kept as a patch
file next to the pinned upstream checkout in CI, not vendored here):

1. `st_weights.c`: under `__EMSCRIPTEN__`, route file opens through normal
   `fopen`/`fread` against Emscripten MEMFS (populated at runtime from
   validated user-imported bytes), keep the packed INT4/INT8 layout and
   alignment untouched, and free the read-backed allocation in the matching
   `st_file_close`. Measure the transient copy; the loader never keeps two
   full copies after init.
2. Thread pool: build the portable scalar kernels only; `st_pool_create(1)`
   must not spawn pthreads. Do **not** link `-pthread`. A pthreads variant is
   a separate optional build (documented, not shipped by default).
3. SIMD: baseline build does **not** enable `-msimd128` until scalar output is
   verified sample-for-sample against the native C Edge reference. Any later
   SIMD build is a second artifact with bounded-drift tests.

No other upstream source changes are expected. If the pinned upstream revision
changes, re-verify `c/include/steertts.h` exports against `scl_bridge.c`.
