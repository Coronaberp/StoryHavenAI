import base64
import io
import zipfile

import httpx

from backend.state import CFG, log

PROVIDER_TIMEOUT = httpx.Timeout(120.0)
STABILITY_DEFAULT_URL = "https://api.stability.ai"
NOVELAI_DEFAULT_URL = "https://image.novelai.net"
STABILITY_ASPECT_RATIOS = [
    ("21:9", 21 / 9), ("16:9", 16 / 9), ("3:2", 3 / 2), ("5:4", 5 / 4), ("1:1", 1.0),
    ("4:5", 4 / 5), ("2:3", 2 / 3), ("9:16", 9 / 16), ("9:21", 9 / 21),
]

class ImageProviderError(Exception):
    pass

def nearest_stability_aspect_ratio(width: int, height: int) -> str:
    ratio = width / height
    return min(STABILITY_ASPECT_RATIOS, key=lambda entry: abs(entry[1] - ratio))[0]

def _parse_failure(provider: str, detail: str) -> ImageProviderError:
    log.error("imagegen provider: %s response parse failed: %s", provider, detail)
    return ImageProviderError(f"{provider}: could not read image from response ({detail})")

async def _post(provider: str, url: str, **kwargs) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=PROVIDER_TIMEOUT) as client:
            response = await client.post(url, **kwargs)
    except httpx.HTTPError as request_error:
        log.error("imagegen provider: %s request failed: %s", provider, type(request_error).__name__)
        raise ImageProviderError(f"{provider}: request failed ({request_error})")
    if response.status_code < 200 or response.status_code >= 300:
        log.error("imagegen provider: %s returned status=%s", provider, response.status_code)
        raise ImageProviderError(f"{provider}: service returned HTTP {response.status_code}")
    return response

def _auth_header() -> dict:
    return {"Authorization": f"Bearer {CFG.get('image_provider_key', '')}"}

async def _generate_openai(positive: str, negative: str, width: int, height: int,
                           steps: int, cfg_scale: float, seed: int | None) -> bytes:
    prompt = positive if not negative else f"{positive}\nDo not include: {negative}"
    url = CFG.get("image_provider_url", "").rstrip("/") + "/images/generations"
    response = await _post("openai", url, headers=_auth_header(),
                           json={"model": CFG.get("image_provider_model", ""), "prompt": prompt,
                                 "n": 1, "size": f"{width}x{height}", "response_format": "b64_json"})
    try:
        return base64.b64decode(response.json()["data"][0]["b64_json"])
    except (ValueError, KeyError, IndexError, TypeError) as parse_error:
        raise _parse_failure("openai", type(parse_error).__name__)

async def _generate_stability(positive: str, negative: str, width: int, height: int,
                              steps: int, cfg_scale: float, seed: int | None) -> bytes:
    base = CFG.get("image_provider_url", "").rstrip("/") or STABILITY_DEFAULT_URL
    model = CFG.get("image_provider_model", "") or "core"
    fields = {"prompt": positive, "seed": str(seed or 0),
              "aspect_ratio": nearest_stability_aspect_ratio(width, height),
              "output_format": "png"}
    if negative:
        fields["negative_prompt"] = negative
    response = await _post("stability", f"{base}/v2beta/stable-image/generate/{model}",
                           headers={**_auth_header(), "accept": "image/*"},
                           files={name: (None, value) for name, value in fields.items()})
    return response.content

async def _generate_novelai(positive: str, negative: str, width: int, height: int,
                            steps: int, cfg_scale: float, seed: int | None) -> bytes:
    base = CFG.get("image_provider_url", "").rstrip("/") or NOVELAI_DEFAULT_URL
    response = await _post("novelai", f"{base}/ai/generate-image", headers=_auth_header(),
                           json={"input": positive,
                                 "model": CFG.get("image_provider_model", "") or "nai-diffusion-3",
                                 "action": "generate",
                                 "parameters": {"width": width, "height": height, "scale": cfg_scale,
                                                "steps": steps, "seed": seed or 0,
                                                "negative_prompt": negative, "n_samples": 1,
                                                "sampler": "k_euler_ancestral"}})
    try:
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names = archive.namelist()
            if not names:
                raise _parse_failure("novelai", "empty archive")
            return archive.read(names[0])
    except zipfile.BadZipFile:
        raise _parse_failure("novelai", "not a zip archive")

async def _generate_a1111(positive: str, negative: str, width: int, height: int,
                          steps: int, cfg_scale: float, seed: int | None) -> bytes:
    url = CFG.get("image_provider_url", "").rstrip("/") + "/sdapi/v1/txt2img"
    headers = _auth_header() if CFG.get("image_provider_key") else {}
    response = await _post("a1111", url, headers=headers,
                           json={"prompt": positive, "negative_prompt": negative,
                                 "width": width, "height": height, "steps": steps,
                                 "cfg_scale": cfg_scale,
                                 "seed": seed if seed is not None else -1})
    try:
        return base64.b64decode(response.json()["images"][0])
    except (ValueError, KeyError, IndexError, TypeError) as parse_error:
        raise _parse_failure("a1111", type(parse_error).__name__)

_PROVIDERS = {
    "openai": _generate_openai,
    "stability": _generate_stability,
    "novelai": _generate_novelai,
    "a1111": _generate_a1111,
}

async def generate_via_provider(positive: str, negative: str, width: int, height: int,
                                steps: int, cfg_scale: float, seed: int | None) -> bytes:
    provider = CFG.get("image_provider", "comfyui")
    generate = _PROVIDERS.get(provider)
    if generate is None:
        raise ImageProviderError(f"unknown image provider: {provider}")
    image_bytes = await generate(positive, negative, width, height, steps, cfg_scale, seed)
    log.info("imagegen provider: %s generated size=%sx%s steps=%s", provider, width, height, steps)
    return image_bytes
