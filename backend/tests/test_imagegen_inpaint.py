import json
import struct
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend import imagegen

pytestmark = pytest.mark.asyncio


class _FakeWSMessage:
    def __init__(self, payload):
        self._payload = payload


async def _fake_ws_iter(messages):
    for m in messages:
        yield m


@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
async def test_generate_inpaint_image_stream_yields_done(mock_ws_connect, mock_client_cls):
    upload_resp = MagicMock()
    upload_resp.json.return_value = {"name": "uploaded.png"}
    upload_resp.raise_for_status = MagicMock()

    prompt_resp = MagicMock()
    prompt_resp.status_code = 200
    prompt_resp.json.return_value = {"prompt_id": "pid-1"}
    prompt_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {
        "pid-1": {"status": {"status_str": "success"},
                  "outputs": {"9": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]}}}
    }
    history_resp.raise_for_status = MagicMock()

    view_resp = MagicMock()
    view_resp.content = b"PNGDATA"
    view_resp.raise_for_status = MagicMock()

    client_instance = AsyncMock()
    client_instance.post.side_effect = [upload_resp, upload_resp, prompt_resp]
    client_instance.get.side_effect = [history_resp, view_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    finished_msg = json.dumps({"type": "executing", "data": {"prompt_id": "pid-1", "node": None}})
    ws_instance = AsyncMock()
    ws_instance.__aiter__ = MagicMock(return_value=_fake_ws_iter([finished_msg]))
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    results = []
    async for kind, data in imagegen.generate_inpaint_image_stream(
            "a cat", "blurry", "http://comfyui:8188", "model.safetensors",
            b"IMAGEBYTES", b"MASKBYTES", denoise=0.8):
        results.append((kind, data))

    assert results == [("done", b"PNGDATA")]
