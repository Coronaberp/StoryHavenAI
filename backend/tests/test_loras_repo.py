import pytest

from backend.repositories import loras

pytestmark = pytest.mark.asyncio

async def test_lora_preview_meta_and_visibility(db_conn):
    name = "lora-1.safetensors"
    await loras.set_preview(name, "data:image/png;base64,xyz")
    assert await loras.get_preview(name) == "data:image/png;base64,xyz"

    await loras.set_meta(name, "Lora One", "desc", model_category=["sdxl"], keywords=["trigger1"])
    previews = await loras.list_previews()
    assert previews[name]["display_name"] == "Lora One"
    assert previews[name]["model_category"] == ["sdxl"]
    assert previews[name]["keywords"] == ["trigger1"]

    assert await loras.get_visibility(name) is None
    await loras.gate_visibility(name, "user-1")
    visibility = await loras.get_visibility(name)
    assert visibility["is_published"] == 0
    assert visibility["created_by"] == "user-1"

    unpublished = await loras.list_unpublished_names()
    assert name in unpublished

    await loras.set_published(name, True)
    all_vis = await loras.list_all_visibility()
    assert all_vis[name] is True
    unpublished_after = await loras.list_unpublished_names()
    assert name not in unpublished_after

    await loras.delete_visibility(name)
    assert await loras.get_visibility(name) is None

    await loras.delete_preview(name)
    assert await loras.get_preview(name) is None
