import pytest

from backend import ssrf
from backend import llm


def _fake_getaddrinfo(ip):
    def _fn(host, port):
        return [(None, None, None, "", (ip, 0))]
    return _fn


@pytest.mark.asyncio
@pytest.mark.parametrize("ip", [
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
])
async def test_resolve_host_ip_issue_rejects_private_ipv4_and_ipv6(monkeypatch, ip):
    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _fake_getaddrinfo(ip))
    issue = await ssrf._resolve_host_ip_issue("http://evil.example/v1", is_admin=False)
    assert issue is not None
    assert ip in issue


@pytest.mark.asyncio
async def test_resolve_host_ip_issue_allows_public_ip(monkeypatch):
    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _fake_getaddrinfo("93.184.216.34"))
    issue = await ssrf._resolve_host_ip_issue("http://example.com/v1", is_admin=False)
    assert issue is None


@pytest.mark.asyncio
async def test_resolve_host_ip_issue_skipped_for_admin(monkeypatch):
    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _fake_getaddrinfo("127.0.0.1"))
    issue = await ssrf._resolve_host_ip_issue("http://internal.example/v1", is_admin=True)
    assert issue is None


@pytest.mark.asyncio
async def test_resolve_pinned_host_rejects_literal_private_ip(monkeypatch):
    """resolve_pinned_host must fail closed even when the URL's host is already
    a literal IP (not just a hostname needing resolution) — a caller invoking
    it directly with an unvalidated URL must not get a silent bypass just
    because there's no hostname to resolve."""
    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _fake_getaddrinfo("127.0.0.1"))
    with pytest.raises(ValueError):
        await ssrf.resolve_pinned_host("http://127.0.0.1:1/v1", is_admin=False)


@pytest.mark.asyncio
async def test_resolve_pinned_host_pins_hostname_to_resolved_ip(monkeypatch):
    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _fake_getaddrinfo("93.184.216.34"))
    pinned, original_host = await ssrf.resolve_pinned_host("http://example.com/v1/chat", is_admin=False)
    assert "93.184.216.34" in pinned
    assert original_host == "example.com"


@pytest.mark.asyncio
async def test_list_models_pin_host_connects_to_pinned_ip_not_hostname(monkeypatch):
    """GET /api/models must not re-resolve DNS after validation — otherwise a
    DNS-rebinding attacker can answer the validation lookup with a public IP
    and the connect lookup with a private one. list_models(pin_host=True)
    should send its request to the IP that resolve_pinned_host already
    validated, with the original hostname preserved in the Host header."""
    monkeypatch.setattr(ssrf.socket, "getaddrinfo", lambda host, port: [(None, None, None, "", ("93.184.216.34", 0))])

    captured = {}

    class _FakeResponse:
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {"data": [{"id": "test-model"}]}

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        def build_request(self, method, url, headers=None, extensions=None, **kw):
            captured["url"] = url
            captured["headers"] = headers
            return object()
        async def send(self, req, **kw):
            return _FakeResponse()

    monkeypatch.setattr(llm.httpx, "AsyncClient", _FakeClient)

    models = await llm.list_models(base_url="http://example.com/v1", pin_host=True, is_admin=False)

    assert models == ["test-model"]
    assert "93.184.216.34" in captured["url"]
    assert "example.com" not in captured["url"]
    assert captured["headers"]["Host"] == "example.com"
