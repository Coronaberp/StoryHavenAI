import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend import imagegen

pytestmark = pytest.mark.asyncio


async def _fake_ws_iter(messages):
    for m in messages:
        yield m


@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
async def test_generate_video_stream_text_to_video_yields_done(mock_ws_connect, mock_client_cls):
    prompt_resp = MagicMock()
    prompt_resp.status_code = 200
    prompt_resp.json.return_value = {"prompt_id": "pid-vid"}
    prompt_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {
        "pid-vid": {"status": {"status_str": "success"},
                    "outputs": {"11": {"videos": [{"filename": "out.mp4", "subfolder": "", "type": "output"}]}}}
    }
    history_resp.raise_for_status = MagicMock()

    view_resp = MagicMock()
    view_resp.content = b"MP4DATA"
    view_resp.raise_for_status = MagicMock()

    client_instance = AsyncMock()
    client_instance.post.side_effect = [prompt_resp]
    client_instance.get.side_effect = [history_resp, view_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    finished_msg = json.dumps({"type": "executing", "data": {"prompt_id": "pid-vid", "node": None}})
    ws_instance = AsyncMock()
    ws_instance.__aiter__ = MagicMock(return_value=_fake_ws_iter([finished_msg]))
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    results = []
    async for kind, data in imagegen.generate_video_stream(
            "a dog running", "blurry", "http://comfyui:8188",
            "wan_unet.safetensors", "wan_clip.safetensors", "wan_vae.safetensors",
            fps=16, num_frames=33):
        results.append((kind, data))

    assert ("done", b"MP4DATA") in results


@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
async def test_generate_video_stream_reports_progress(mock_ws_connect, mock_client_cls):
    prompt_resp = MagicMock()
    prompt_resp.status_code = 200
    prompt_resp.json.return_value = {"prompt_id": "pid-vid2"}
    prompt_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {
        "pid-vid2": {"status": {"status_str": "success"},
                     "outputs": {"11": {"videos": [{"filename": "out.mp4", "subfolder": "", "type": "output"}]}}}
    }
    history_resp.raise_for_status = MagicMock()

    view_resp = MagicMock()
    view_resp.content = b"MP4DATA2"
    view_resp.raise_for_status = MagicMock()

    client_instance = AsyncMock()
    client_instance.post.side_effect = [prompt_resp]
    client_instance.get.side_effect = [history_resp, view_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    progress_msg1 = json.dumps({"type": "progress", "data": {"value": 1, "max": 20, "prompt_id": "pid-vid2"}})
    progress_msg2 = json.dumps({"type": "progress", "data": {"value": 1, "max": 20, "prompt_id": "pid-vid2"}})
    progress_msg3 = json.dumps({"type": "progress", "data": {"value": 2, "max": 20, "prompt_id": "pid-vid2"}})
    finished_msg = json.dumps({"type": "executing", "data": {"prompt_id": "pid-vid2", "node": None}})
    ws_instance = AsyncMock()
    ws_instance.__aiter__ = MagicMock(return_value=_fake_ws_iter([progress_msg1, progress_msg2, progress_msg3, finished_msg]))
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    results = []
    async for kind, data in imagegen.generate_video_stream(
            "a dog running", "blurry", "http://comfyui:8188",
            "wan_unet.safetensors", "wan_clip.safetensors", "wan_vae.safetensors",
            fps=16, num_frames=33):
        results.append((kind, data))

    status_msgs = [data for kind, data in results if kind == "status" and data.startswith("sampling")]
    assert status_msgs == ["sampling 1/20", "sampling 2/20"]
    assert ("done", b"MP4DATA2") in results


@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
async def test_generate_video_stream_finds_output_under_images_key(mock_ws_connect, mock_client_cls):
    """SaveVideo's UI output reuses the "images" key from the existing
    gallery convention rather than a video-specific key — a real run once
    finished sampling successfully but was reported as "produced no video
    output" because only "videos"/"gifs" were checked."""
    prompt_resp = MagicMock()
    prompt_resp.status_code = 200
    prompt_resp.json.return_value = {"prompt_id": "pid-vid3"}
    prompt_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {
        "pid-vid3": {"status": {"status_str": "success"},
                     "outputs": {"11": {"images": [{"filename": "out.mp4", "subfolder": "", "type": "output"}]}}}
    }
    history_resp.raise_for_status = MagicMock()

    view_resp = MagicMock()
    view_resp.content = b"MP4DATA3"
    view_resp.raise_for_status = MagicMock()

    client_instance = AsyncMock()
    client_instance.post.side_effect = [prompt_resp]
    client_instance.get.side_effect = [history_resp, view_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    finished_msg = json.dumps({"type": "executing", "data": {"prompt_id": "pid-vid3", "node": None}})
    ws_instance = AsyncMock()
    ws_instance.__aiter__ = MagicMock(return_value=_fake_ws_iter([finished_msg]))
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    results = []
    async for kind, data in imagegen.generate_video_stream(
            "a dog running", "blurry", "http://comfyui:8188",
            "wan_unet.safetensors", "wan_clip.safetensors", "wan_vae.safetensors",
            fps=16, num_frames=33):
        results.append((kind, data))

    assert ("done", b"MP4DATA3") in results


@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
async def test_generate_video_stream_surfaces_comfyui_rejection_detail(mock_ws_connect, mock_client_cls):
    prompt_resp = MagicMock()
    prompt_resp.status_code = 400
    prompt_resp.text = "raw error text"
    prompt_resp.json.return_value = {"node_errors": {"11": {"errors": [{"message": "Required input is missing"}]}}}

    client_instance = AsyncMock()
    client_instance.post.side_effect = [prompt_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    ws_instance = AsyncMock()
    ws_instance.__aiter__ = MagicMock(return_value=_fake_ws_iter([]))
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    with pytest.raises(RuntimeError, match="Required input is missing"):
        async for _ in imagegen.generate_video_stream(
                "a dog running", "blurry", "http://comfyui:8188",
                "wan_unet.safetensors", "wan_clip.safetensors", "wan_vae.safetensors",
                fps=16, num_frames=33):
            pass
