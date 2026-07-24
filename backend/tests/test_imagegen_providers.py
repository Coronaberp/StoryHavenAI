import base64
import io
import json
import zipfile

import httpx
import pytest
from fastapi import HTTPException

from backend import imagegen_providers
from backend.imagegen_providers import (ImageProviderError, generate_via_provider,
                                        nearest_stability_aspect_ratio)
from backend.state import CFG

pytestmark = pytest.mark.asyncio

PNG_BYTES = b"\x89PNG\r\n\x1a\nfakeimagedata"

class FakeResponse:
    def __init__(self, status_code=200, json_data=None, content=b""):
        self.status_code = status_code
        self._json = json_data
        self.content = content

    def json(self):
        if self._json is None:
            raise ValueError("no json")
        return self._json

class FakeAsyncClient:
    calls = []
    response = None

    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        FakeAsyncClient.calls.append({"url": url, **kwargs})
        return FakeAsyncClient.response

@pytest.fixture
def fake_http(monkeypatch):
    FakeAsyncClient.calls = []
    FakeAsyncClient.response = FakeResponse()
    monkeypatch.setattr(imagegen_providers.httpx, "AsyncClient", FakeAsyncClient)
    return FakeAsyncClient

@pytest.fixture
def provider_cfg(monkeypatch):
    def set_cfg(provider, url="", key="", model=""):
        monkeypatch.setitem(CFG, "image_provider", provider)
        monkeypatch.setitem(CFG, "image_provider_url", url)
        monkeypatch.setitem(CFG, "image_provider_key", key)
        monkeypatch.setitem(CFG, "image_provider_model", model)
    return set_cfg

async def test_openai_payload_and_parse(fake_http, provider_cfg):
    provider_cfg("openai", url="https://api.example.com/v1", key="sk-test", model="dall-e-3")
    fake_http.response = FakeResponse(json_data={
        "data": [{"b64_json": base64.b64encode(PNG_BYTES).decode()}]})
    result = await generate_via_provider("a cat", "dogs", 1024, 1024, 20, 7.0, None)
    assert result == PNG_BYTES
    call = fake_http.calls[0]
    assert call["url"] == "https://api.example.com/v1/images/generations"
    assert call["headers"]["Authorization"] == "Bearer sk-test"
    body = call["json"]
    assert body["model"] == "dall-e-3"
    assert body["prompt"] == "a cat\nDo not include: dogs"
    assert body["n"] == 1
    assert body["size"] == "1024x1024"
    assert body["response_format"] == "b64_json"

async def test_openai_empty_negative_not_appended(fake_http, provider_cfg):
    provider_cfg("openai", url="https://api.example.com/v1", key="sk-test")
    fake_http.response = FakeResponse(json_data={
        "data": [{"b64_json": base64.b64encode(PNG_BYTES).decode()}]})
    await generate_via_provider("a cat", "", 512, 512, 20, 7.0, None)
    assert fake_http.calls[0]["json"]["prompt"] == "a cat"

async def test_stability_payload_and_binary_response(fake_http, provider_cfg):
    provider_cfg("stability", key="sk-stab", model="ultra")
    fake_http.response = FakeResponse(content=PNG_BYTES)
    result = await generate_via_provider("a castle", "people", 1024, 576, 30, 6.0, 42)
    assert result == PNG_BYTES
    call = fake_http.calls[0]
    assert call["url"] == "https://api.stability.ai/v2beta/stable-image/generate/ultra"
    assert call["headers"]["Authorization"] == "Bearer sk-stab"
    assert call["headers"]["accept"] == "image/*"
    fields = {name: value for name, (_, value) in call["files"].items()}
    assert fields["prompt"] == "a castle"
    assert fields["negative_prompt"] == "people"
    assert fields["seed"] == "42"
    assert fields["aspect_ratio"] == "16:9"
    assert fields["output_format"] == "png"

async def test_nearest_stability_aspect_ratio():
    assert nearest_stability_aspect_ratio(1024, 1024) == "1:1"
    assert nearest_stability_aspect_ratio(1920, 1080) == "16:9"
    assert nearest_stability_aspect_ratio(1080, 1920) == "9:16"
    assert nearest_stability_aspect_ratio(2100, 900) == "21:9"

async def test_novelai_payload_and_zip_parse(fake_http, provider_cfg):
    provider_cfg("novelai", key="nai-key")
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive:
        archive.writestr("image_0.png", PNG_BYTES)
    fake_http.response = FakeResponse(content=archive_buffer.getvalue())
    result = await generate_via_provider("a fox", "wolves", 832, 1216, 28, 5.0, None)
    assert result == PNG_BYTES
    call = fake_http.calls[0]
    assert call["url"] == "https://image.novelai.net/ai/generate-image"
    assert call["headers"]["Authorization"] == "Bearer nai-key"
    body = call["json"]
    assert body["input"] == "a fox"
    assert body["model"] == "nai-diffusion-3"
    assert body["action"] == "generate"
    params = body["parameters"]
    assert params["width"] == 832
    assert params["height"] == 1216
    assert params["scale"] == 5.0
    assert params["steps"] == 28
    assert params["seed"] == 0
    assert params["negative_prompt"] == "wolves"
    assert params["n_samples"] == 1
    assert params["sampler"] == "k_euler_ancestral"

async def test_novelai_bad_zip_raises(fake_http, provider_cfg):
    provider_cfg("novelai", key="nai-key")
    fake_http.response = FakeResponse(content=b"not a zip")
    with pytest.raises(ImageProviderError):
        await generate_via_provider("a fox", "", 832, 1216, 28, 5.0, None)

async def test_a1111_payload_and_parse(fake_http, provider_cfg):
    provider_cfg("a1111", url="http://sd.local:7860")
    fake_http.response = FakeResponse(json_data={
        "images": [base64.b64encode(PNG_BYTES).decode()]})
    result = await generate_via_provider("a ship", "storms", 768, 512, 25, 8.0, None)
    assert result == PNG_BYTES
    call = fake_http.calls[0]
    assert call["url"] == "http://sd.local:7860/sdapi/v1/txt2img"
    assert "Authorization" not in call["headers"]
    body = call["json"]
    assert body["prompt"] == "a ship"
    assert body["negative_prompt"] == "storms"
    assert body["width"] == 768
    assert body["height"] == 512
    assert body["steps"] == 25
    assert body["cfg_scale"] == 8.0
    assert body["seed"] == -1

async def test_a1111_sends_key_and_seed_when_set(fake_http, provider_cfg):
    provider_cfg("a1111", url="http://sd.local:7860", key="secret")
    fake_http.response = FakeResponse(json_data={
        "images": [base64.b64encode(PNG_BYTES).decode()]})
    await generate_via_provider("a ship", "", 768, 512, 25, 8.0, 1234)
    call = fake_http.calls[0]
    assert call["headers"]["Authorization"] == "Bearer secret"
    assert call["json"]["seed"] == 1234

async def test_non_2xx_raises_provider_error(fake_http, provider_cfg):
    provider_cfg("openai", url="https://api.example.com/v1", key="sk-test")
    fake_http.response = FakeResponse(status_code=401)
    with pytest.raises(ImageProviderError) as exc_info:
        await generate_via_provider("a cat", "", 512, 512, 20, 7.0, None)
    assert "401" in str(exc_info.value)

async def test_parse_failure_raises_provider_error(fake_http, provider_cfg):
    provider_cfg("openai", url="https://api.example.com/v1", key="sk-test")
    fake_http.response = FakeResponse(json_data={"data": []})
    with pytest.raises(ImageProviderError):
        await generate_via_provider("a cat", "", 512, 512, 20, 7.0, None)

async def test_dispatch_unknown_provider_raises(provider_cfg):
    provider_cfg("comfyui")
    with pytest.raises(ImageProviderError):
        await generate_via_provider("a cat", "", 512, 512, 20, 7.0, None)

async def test_dispatch_honors_cfg_provider(fake_http, provider_cfg):
    provider_cfg("a1111", url="http://sd.local:7860")
    fake_http.response = FakeResponse(json_data={
        "images": [base64.b64encode(PNG_BYTES).decode()]})
    await generate_via_provider("a cat", "", 512, 512, 20, 7.0, None)
    assert fake_http.calls[0]["url"].endswith("/sdapi/v1/txt2img")

async def test_guarded_endpoints_400_with_hosted_provider(monkeypatch):
    from backend.routers.imagegen import stream_inpaint_image, stream_video, upscale_standalone_image
    from backend.schemas import ImageGenInpaintIn, ImageGenVideoIn, ImageGenUpscaleIn
    monkeypatch.setitem(CFG, "image_provider", "openai")
    user = {"id": "user-a", "username": "user-a", "is_admin": True}
    inpaint_body = ImageGenInpaintIn(image="data:image/png;base64,AAAA",
                                     mask="data:image/png;base64,AAAA",
                                     positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(inpaint_body, current_user=user)
    assert exc_info.value.status_code == 400
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(ImageGenVideoIn(positive="a cat", negative=""), current_user=user)
    assert exc_info.value.status_code == 400
    with pytest.raises(HTTPException) as exc_info:
        await upscale_standalone_image(ImageGenUpscaleIn(image="data:image/png;base64,AAAA"),
                                       current_user=user)
    assert exc_info.value.status_code == 400
