# Image safety classifier

StoryHaven uses a local, CPU-only ONNX Runtime classifier for uploaded images. The
default backend is `onnx_nano`, backed by `viddexa/nsfw-detection-2-nano` at the
pinned revision `12e57200346246b37382f746e4d94d10b014f6a1`.

## Moderation policy

The classifier is fail closed. An image is allowed only when the model's highest
probability is either `safe` or `drawing`, and that probability is at least
`NSFW_SAFE_THRESHOLD`. The default is `0.995`. `hentai`, `porn`, and `sexy` are
never allow classes. Invalid input, uncertainty, timeouts, model errors, and
resource failures all produce a blocking decision.

The class order is pinned to the model mapping:

```text
safe, hentai, porn, sexy, drawing
```

## Runtime contract

The production process uses one persistent ONNX Runtime CPU session, one active
model execution, and a bounded admission queue. PyTorch and Transformers are
build-time dependencies only. Source images are decoded with bounded byte,
pixel, and dimension limits, normalized to the pinned processor contract, and
reduced to one contiguous `float32` tensor with shape `[1, 3, 224, 224]`.

The pinned processor uses direct nearest-neighbor resize, RGB conversion, the
published mean and standard deviation values, and its `include_top=true`
normalization behavior. Export tooling compares this preprocessing against the
Hugging Face processor before producing the ONNX artifact.

## Artifact provisioning

The ONNX binary is intentionally outside Git and is ignored under the local
model directory. Build it in a disposable environment with
`requirements-safety-export.txt`:

```bash
python scripts/export_safety_classifier.py --output-dir <artifact-directory>
python scripts/verify_safety_artifact.py --manifest <artifact-directory>/manifest.json
```

Provision the resulting `model.onnx` using the path configured by
`NSFW_ONNX_PATH`, and set `NSFW_ONNX_SHA256` to the checksum in the manifest.
The runtime refuses missing, non-ONNX, or checksum-mismatched artifacts. The
manifest records the model revision, class order, graph shape, preprocessing
metadata, and build tool versions.

Relevant settings are centralized in `backend/safety/config.py`. The normal
production settings are:

```text
SAFETY_CLASSIFIER_BACKEND=onnx_nano
NSFW_SAFE_THRESHOLD=0.995
NSFW_RUNTIME_THREADS=1
NSFW_INTER_OP_THREADS=1
```

For staging comparison, `NSFW_SHADOW_LEGACY=true` runs both classifiers and
records disagreements while keeping the legacy result authoritative. The
legacy comparison is bounded to one remote call at a time. Keep it disabled in
normal production operation, especially when the legacy service is unavailable.

INT8 quantization is not enabled. It requires a representative validation run
and a comparison showing no moderation regression.

## Validation and benchmarking

The local validation manifest supports these categories:

- `safe_photo`
- `safe_drawing`
- `borderline`
- `explicit`
- `hentai`
- `ood`

Use `scripts/benchmark_safety_classifier.py` to evaluate the candidate
thresholds `0.980`, `0.990`, `0.995`, `0.997`, and `0.999`. The report includes
safe/unsafe confusion counts, borderline decisions, per-class score
distributions, cold startup, 100-request warm inference, sustained inference,
queue behavior, latency percentiles, RSS, available memory, and maximum active
inferences.

The benchmark must be run on the actual 1-vCPU, 2-GB deployment host before
production rollout. Confirm stable RSS, zero OOM events, no sustained swap
thrashing, and exactly one active inference. Desktop results are useful for
development but do not replace the deployment-host measurement.

## Health and rollback

The existing service-health name `image_classify_llm` remains stable for the
admin UI. In ONNX mode it reports local readiness without running an inference.
The authenticated application health response includes a non-secret readiness
summary and aggregate classifier metrics.

The explicit rollback setting is:

```text
SAFETY_CLASSIFIER_BACKEND=legacy
```

Rollback is configuration-only and never happens automatically when ONNX is
unavailable. With the default `onnx_nano` backend, unavailable moderation
blocks images until the artifact or configuration is repaired.

The classifier is an internal application component, not a public inference
endpoint. It accepts no arbitrary model paths from requests and does not log
image bytes, base64 payloads, or secret-bearing URLs.
