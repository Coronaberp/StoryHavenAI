# Safety classifier benchmark

This directory documents local validation inputs and stores benchmark results
outside the source tree. Do not commit image files or generated result files.

## Dataset manifest

The manifest is JSON with paths relative to the manifest directory:

```json
{
  "images": [
    {"path": "safe/photo-001.jpg", "category": "safe_photo"},
    {"path": "anime/portrait-001.png", "category": "safe_drawing"},
    {"path": "borderline/swimsuit-001.jpg", "category": "borderline"},
    {"path": "explicit/photo-001.jpg", "category": "explicit"},
    {"path": "hentai/drawing-001.png", "category": "hentai"},
    {"path": "ood/noise-001.png", "category": "ood"}
  ]
}
```

Use representative generated and anime content in `safe_drawing`, and include
corrupted, blank, noisy, blurred, text-only, and unusual-aspect-ratio inputs in
`ood`. Keep explicit and hentai examples available for manual review of every
candidate threshold.

## Run

First provision and verify the pinned artifact. Then run the benchmark from the
repository root:

```bash
python scripts/benchmark_safety_classifier.py \
  --manifest <artifact-directory>/manifest.json \
  --dataset <dataset-directory>/manifest.json \
  --output <results-directory>/safety-classifier.json
```

The default warm phase sends 100 sequential requests. The sustained phase is
three minutes by default. Use `--sustained-seconds` for a shorter development
smoke test, but use the full duration on the actual 1-vCPU, 2-GB host.

The threshold table prioritizes explicit, hentai, and borderline false
negatives over safe-image recall. The selected production threshold remains
`0.995` unless validation evidence justifies a stricter value. Never enable INT8
based only on latency or memory results.

Record the generated JSON with the deployment notes, including cold startup,
warm p50/p95/p99/max latency, sustained RSS before/peak/after, available memory,
queue results, timeout/error counts, and maximum active inferences. A result
with more than one active inference is a failed safety benchmark.
