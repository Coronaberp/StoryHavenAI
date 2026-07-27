import pytest
from httpx import AsyncClient, ASGITransport


@pytest.mark.asyncio
async def test_fetch_model_request_requires_dev_role():
    import server
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/admin/model-requests/nonexistent/fetch")
        assert r.status_code in (401, 403)
