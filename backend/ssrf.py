"""SSRF guard for user bring-your-own chat endpoints."""
import asyncio
import socket
import ipaddress
import urllib.parse

import httpx

from backend import llm
from backend.state import log

async def resolve_pinned_host(url: str, is_admin: bool = False) -> tuple[str, str | None]:
    """Resolve the URL's hostname once, validate it via _resolve_host_ip_issue,
    and return (pinned_url, original_host) with the hostname replaced by the
    validated literal IP address.

    Without this, a caller that validates a hostname and then lets httpx
    re-resolve the same hostname to actually connect leaves a DNS-rebinding
    window open: an attacker's DNS server can answer the validation lookup
    with a public IP and the connect lookup (moments later) with a private
    one, since the two lookups aren't guaranteed to return the same answer.
    Pinning the connection to the exact address that was checked closes that
    window. original_host is returned so the caller can still send the
    correct Host header / TLS SNI — connecting by IP alone would otherwise
    break virtual-hosted / HTTPS-SNI-routed endpoints and cert validation.

    Returns (url, None) unchanged for admins (private addresses are allowed
    for them) or when the host is already a literal IP."""
    if is_admin:
        return url, None
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname
    except Exception as e:
        log.warning("ssrf: could not parse hostname for pinning, using URL as-is error=%s", e)
        return url, None
    if not host:
        return url, None
    issue = await _resolve_host_ip_issue(url, is_admin)
    if issue:
        raise ValueError(issue)
    try:
        ipaddress.ip_address(host)
        return url, None
    except ValueError:
        pass
    try:
        loop = asyncio.get_event_loop()
        infos = await loop.run_in_executor(None, socket.getaddrinfo, host, None)
        ip = infos[0][4][0]
        ipaddress.ip_address(ip)
    except Exception as e:
        log.warning("ssrf: could not resolve host=%s for pinning, rejecting error=%s", host, e)
        raise ValueError(f"Could not resolve {host} to pin the connection — request rejected") from e
    netloc = f"[{ip}]" if ":" in ip else ip
    if parsed.port:
        netloc += f":{parsed.port}"
    if parsed.username:
        auth = parsed.username + (f":{parsed.password}" if parsed.password else "")
        netloc = f"{auth}@{netloc}"
    pinned = parsed._replace(netloc=netloc).geturl()
    return pinned, host


async def _resolve_host_ip_issue(url: str, is_admin: bool = False) -> str | None:
    """The actual SSRF stop: resolves the URL's hostname and returns a reason
    string if ANY resolved address is private/loopback/link-local/reserved —
    without this, base_url could point at redis/comfyui/any other container
    on the shared docker network, or at localhost, turning the server into a
    proxy for probing the internal network. Returns None if every address is
    a real public one. Cheap enough to re-run on every actual use (see
    _endpoints), not just when the setting is first saved — a host that was
    a legitimate public IP at save time but re-resolves to something private
    later (DNS rebinding, or the domain simply changing hands/owners) gets
    caught here too, even for a previously-admin-approved endpoint.

    Admins are trusted to point their own chat endpoint at internal
    infrastructure (e.g. the llamacpp-chat container on the same docker
    network) — the private-address check is skipped for them entirely."""
    if is_admin:
        return None
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


async def _validate_chat_endpoint(base_url: str, api_key: str | None,
                                  is_admin: bool = False) -> tuple[bool, str | None, str]:
    """SSRF guard for user-supplied bring-your-own chat endpoints, run at save
    time. Returns (ok, reason, detail) — reason is None on success, or a short
    explanation of why the endpoint was rejected (shown to the user and left
    for admin review); detail is a full raw network log of every path tried
    (HTTP status codes, response body snippets, exceptions) for the admin queue.
    Two checks, either of which fails closed:
    1. _resolve_host_ip_issue — must not resolve to a private/internal address
       (skipped for admins — see that function).
    2. The endpoint must answer like a real chat server on at least one known
       API shape (see _KNOWN_MODEL_LIST_SHAPES). NEVER skipped, not even for
       admins: a private-IP exemption lets a trusted admin point at internal
       infra, but it does not exempt them from the endpoint actually behaving
       like an OpenAI-compatible API. A host that resolves publicly but doesn't
       speak any recognized protocol (or errors oddly on all of them) is exactly
       what a scripted internal-probe-via-public-redirector would look like, so
       the connection is cut and it's flagged for admin review with the raw log.
    """
    ip_issue = await _resolve_host_ip_issue(base_url, is_admin)
    if ip_issue:
        return False, ip_issue, ip_issue

    root = llm._mk_root(base_url)
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    errors = []
    log_lines = []
    async with httpx.AsyncClient(timeout=8) as client:
        for path, shape_ok in _KNOWN_MODEL_LIST_SHAPES:
            target = root + path
            try:
                resp = await client.get(target, headers=headers)
                body = (resp.text or "")[:500]
                if resp.status_code >= 400:
                    errors.append(f"{path} -> HTTP {resp.status_code}")
                    log_lines.append(f"GET {target}\n  <- HTTP {resp.status_code}\n  body: {body}")
                    continue
                try:
                    parsed = resp.json()
                except Exception as je:
                    errors.append(f"{path} -> non-JSON response")
                    log_lines.append(f"GET {target}\n  <- HTTP {resp.status_code} (non-JSON: {je})\n  body: {body}")
                    continue
                if shape_ok(parsed):
                    return True, None, ""
                errors.append(f"{path} -> unexpected response shape")
                log_lines.append(f"GET {target}\n  <- HTTP {resp.status_code} (unexpected shape)\n  body: {body}")
            except Exception as e:
                errors.append(f"{path} -> {e}")
                log_lines.append(f"GET {target}\n  <- error: {type(e).__name__}: {e}")
    reason = "endpoint did not respond like a known chat API on any known path (" + "; ".join(errors) + ")"
    return False, reason, "\n\n".join(log_lines)

