import pytest

from backend.repositories import checkpoints

pytestmark = pytest.mark.asyncio

async def test_checkpoint_preview_and_meta(db_conn):
    name = "checkpoint-1.safetensors"
    assert await checkpoints.get_preview(name) is None

    await checkpoints.set_preview(name, "data:image/png;base64,abc")
    assert await checkpoints.get_preview(name) == "data:image/png;base64,abc"

    await checkpoints.set_meta(name, "Checkpoint One", "a test checkpoint",
                                model_type="sdxl", default_steps=30,
                                anima_clip_name="clip.safetensors", anima_vae_name="vae.safetensors")
    previews = await checkpoints.list_previews()
    assert previews[name]["display_name"] == "Checkpoint One"
    assert previews[name]["description"] == "a test checkpoint"
    assert previews[name]["model_type"] == "sdxl"
    assert previews[name]["default_steps"] == 30

    clip, vae = await checkpoints.get_anima_overrides(name)
    assert clip == "clip.safetensors"
    assert vae == "vae.safetensors"

    await checkpoints.delete_preview(name)
    assert await checkpoints.get_preview(name) is None
