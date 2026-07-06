"""SSRF guard for user bring-your-own chat endpoints."""
import asyncio
import socket
import ipaddress
import urllib.parse

import httpx

import llm

async def _resolve_host_ip_issue(url: str) -> str | None:
    """The actual SSRF stop: resolves the URL's hostname and returns a reason
    string if ANY resolved address is private/loopback/link-local/reserved —
    without this, base_url could point at redis/comfyui/any other container
    on the shared docker network, or at localhost, turning the server into a
    proxy for probing the internal network. Returns None if every address is
    a real public one. Cheap enough to re-run on every actual use (see
    _endpoints), not just when the setting is first saved — a host that was
    a legitimate public IP at save time but re-resolves to something private
    later (DNS rebinding, or the domain simply changing hands/owners) gets
    caught here too, even for a previously-admin-approved endpoint."""
    try:
        host = urllib.parse.urlparse(url).hostname
    except Exception:
        return "could not parse a hostname from that URL"
    if not host:
        return "could not parse a hostname from that URL"
    try:
        loop = asyncio.get_event_loop()
        infos = await loop.run_in_executor(None, socket.getaddrinfo, host, None)
    except Exception as e:
        return f"could not resolve hostname: {e}"
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return f"resolves to a non-public address ({addr}) — refusing to connect"
    return None


# Known shapes of a legitimate OpenAI-compatible-ish chat server's "list models"
# response, tried in order — different backends (OpenAI itself, vLLM, LM Studio,
# llama.cpp server all speak the /v1 form; Ollama's own native API uses /api/tags
# instead) expose this differently, so a real server should match at least one.
_KNOWN_MODEL_LIST_SHAPES = (
    ("/models", lambda d: isinstance(d, dict) and isinstance(d.get("data"), list)),
    ("/api/tags", lambda d: isinstance(d, dict) and isinstance(d.get("models"), list)),
    ("/api/version", lambda d: isinstance(d, dict) and "version" in d),
)


async def _validate_chat_endpoint(base_url: str, api_key: str | None) -> tuple[bool, str | None]:
    """SSRF guard for user-supplied bring-your-own chat endpoints, run at save
    time. Returns (ok, reason) — reason is None on success, or a short
    explanation of why the endpoint was rejected (shown to the user and left
    for admin review). Two checks, either of which fails closed:
    1. _resolve_host_ip_issue — must not resolve to a private/internal address.
    2. The endpoint must answer like a real chat server on at least one known
       API shape (see _KNOWN_MODEL_LIST_SHAPES). A host that resolves publicly
       but doesn't speak any recognized protocol (or errors oddly on all of
       them) is exactly what a scripted internal-probe-via-public-redirector
       would look like, so it's treated as suspicious, not "misconfigured" —
       still gets flagged for admin review rather than silently retried.
    """
    ip_issue = await _resolve_host_ip_issue(base_url)
    if ip_issue:
        return False, ip_issue

    root = llm._mk_root(base_url)
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    errors = []
    async with httpx.AsyncClient(timeout=8) as client:
        for path, shape_ok in _KNOWN_MODEL_LIST_SHAPES:
            try:
                resp = await client.get(root + path, headers=headers)
                if resp.status_code >= 400:
                    errors.append(f"{path} -> HTTP {resp.status_code}")
                    continue
                if shape_ok(resp.json()):
                    return True, None
                errors.append(f"{path} -> unexpected response shape")
            except Exception as e:
                errors.append(f"{path} -> {e}")
    return False, "endpoint did not respond like a known chat API on any known path (" + "; ".join(errors) + ")"

