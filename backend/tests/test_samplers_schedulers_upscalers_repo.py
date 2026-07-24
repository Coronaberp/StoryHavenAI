import pytest

from backend.repositories import samplers, schedulers, upscalers

pytestmark = pytest.mark.asyncio

async def test_sampler_scheduler_upscaler_preview_and_meta(db_conn):
    for repo, name in ((samplers, "test-sampler-xyz"), (schedulers, "test-scheduler-xyz"),
                       (upscalers, "test-upscaler-xyz")):
        assert await repo.get_preview(name) is None
        await repo.set_preview(name, "data:image/png;base64,111")
        assert await repo.get_preview(name) == "data:image/png;base64,111"
        await repo.set_meta(name, "Display Name", "description text")
        previews = await repo.list_previews()
        assert previews[name]["display_name"] == "Display Name"
        assert previews[name]["description"] == "description text"
        await repo.delete_preview(name)
        assert await repo.get_preview(name) is None
