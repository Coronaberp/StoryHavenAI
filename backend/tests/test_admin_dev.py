import pytest
from httpx import AsyncClient, ASGITransport


@pytest.mark.asyncio
async def test_e2e_status_requires_dev_role():
    import server
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/admin/dev/e2e-test-status")
        assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_run_e2e_tests_requires_dev_role():
    import server
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/admin/dev/run-e2e-tests")
        assert r.status_code in (401, 403)
