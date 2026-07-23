from unittest.mock import AsyncMock, patch

import pytest

from backend import imagegen_options

pytestmark = pytest.mark.asyncio


@patch("backend.imagegen_options.list_object_options", new_callable=AsyncMock)
async def test_list_wan_unets_queries_unet_loader(mock_list):
    mock_list.return_value = ["wan2.1_1.3b.safetensors"]
    result = await imagegen_options.list_wan_unets("http://comfyui:8188")
    assert result == ["wan2.1_1.3b.safetensors"]
    mock_list.assert_called_once_with("http://comfyui:8188", "UNETLoader", "unet_name")


@patch("backend.imagegen_options.list_object_options", new_callable=AsyncMock)
async def test_list_wan_clip_models_queries_clip_loader(mock_list):
    mock_list.return_value = ["umt5_xxl.safetensors"]
    result = await imagegen_options.list_wan_clip_models("http://comfyui:8188")
    assert result == ["umt5_xxl.safetensors"]
    mock_list.assert_called_once_with("http://comfyui:8188", "CLIPLoader", "clip_name")
