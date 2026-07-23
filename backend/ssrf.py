import asyncio
import socket
import ipaddress
import urllib.parse

import httpx

from backend import llm
from backend.state import log

async def resolve_pinned_host(url: str, is_admin: bool = False) -> tuple[str, str | None]:
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
    if _is_blocked_ip(ip):
        log.warning("ssrf: pinned address for host=%s resolved to blocked ip=%s, rejecting", host, ip)
        raise ValueError(f"{host} resolved to a non-public address when pinning the connection — request rejected")
    netloc = f"[{ip}]" if ":" in ip else ip
    if parsed.port:
        netloc += f":{parsed.port}"
    if parsed.username:
        auth = parsed.username + (f":{parsed.password}" if parsed.password else "")
        netloc = f"{auth}@{netloc}"
    pinned = parsed._replace(netloc=netloc).geturl()
    return pinned, host


async def _resolve_host_ip_issue(url: str, is_admin: bool = False) -> str | None:
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
        if _is_blocked_ip(addr):
            return f"resolves to a non-public address ({addr}) — refusing to connect"
    return None


def _is_blocked_ip(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return (ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified)


_KNOWN_MODEL_LIST_SHAPES = (
    ("/models", lambda d: isinstance(d, dict) and isinstance(d.get("data"), list)),
    ("/api/tags", lambda d: isinstance(d, dict) and isinstance(d.get("models"), list)),
    ("/api/version", lambda d: isinstance(d, dict) and "version" in d),
)


async def _validate_chat_endpoint(base_url: str, api_key: str | None,
                                  is_admin: bool = False) -> tuple[bool, str | None, str]:
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

