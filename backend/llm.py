import json
import re
import logging
import httpx

log = logging.getLogger("storyhavenai")

def strip_json_fence(raw: str) -> str:
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.IGNORECASE).strip()

_base = "http://llamacpp-chat:5001/v1"
_embed_base = "http://llamacpp-embed:5002/v1"
_key = ""
_embed_key = ""

def configure(base_url: str, api_key: str = "", embed_url: str = None,
              embed_key: str = None):
    global _base, _key, _embed_base, _embed_key
    _base, _key = base_url, api_key or ""
    _embed_base = embed_url or base_url
    _embed_key = embed_key if embed_key is not None else ""

def _mk_root(base: str) -> str:
    b = base.strip().rstrip("/")
    if b.endswith("/chat/completions"):
        b = b[: -len("/chat/completions")]
    if b.endswith("/models"):
        b = b[: -len("/models")]
    if b.endswith("/v1") or b.endswith("/api/v1"):
        return b
    return b + "/v1"

def _mk_root_embed(base: str) -> str:
    b = base.strip().rstrip("/")
    if b.endswith("/embeddings"):
        b = b[: -len("/embeddings")]
    if b.endswith("/v1") or b.endswith("/api/v1"):
        return b
    return b + "/v1"

def _root() -> str:
    return _mk_root(_base)

def _root_embed() -> str:
    return _mk_root_embed(_embed_base)

def chat_url():   return _root() + "/chat/completions"
def embed_url():  return _root_embed() + "/embeddings"
def models_url(): return _root() + "/models"

def _headers(api_key=None) -> dict:
    k = api_key if api_key is not None else _key
    return {"Authorization": f"Bearer {k}"} if k else {}

def _headers_embed(api_key=None) -> dict:
    k = api_key if api_key is not None else _embed_key
    return {"Authorization": f"Bearer {k}"} if k else {}

async def list_models(base_url: str = None, api_key: str = None, pin_host: bool = False,
                      is_admin: bool = False) -> list[str]:
    url = (_mk_root(base_url) if base_url else _root()) + "/models"
    headers = _headers(api_key)
    extensions = {}
    if pin_host and base_url:
        from backend import ssrf
        try:
            url, original_host = await ssrf.resolve_pinned_host(url, is_admin)
        except ValueError as e:
            raise RuntimeError(f"chat endpoint became unsafe: {e}") from e
        if original_host:
            headers["Host"] = original_host
            extensions["sni_hostname"] = original_host
    async with httpx.AsyncClient(timeout=15) as client:
        req = client.build_request("GET", url, headers=headers, extensions=extensions)
        resp = await client.send(req)
        resp.raise_for_status()
        data = resp.json().get("data", [])
    return [m.get("id") for m in data if m.get("id")]

async def embed(text: str, model: str,
                base_url: str = None, api_key: str = None) -> list[float]:
    url = (_mk_root_embed(base_url) if base_url else _root_embed()) + "/embeddings"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            url,
            headers=_headers_embed(api_key),
            json={"model": model.strip(), "input": text}
        )
        resp.raise_for_status()
        j = resp.json()
        data = j.get("data") or []
    if not data:
        raise RuntimeError(f"embedding endpoint returned no data. Response: {j}")
    return data[0]["embedding"]

_QUERY_INSTRUCTION = ("Given the current roleplay moment, retrieve character facts, "
                      "relationships, unresolved commitments, and world details needed "
                      "to stay consistent.")

async def embed_query(text: str, model: str,
                      base_url: str = None, api_key: str = None) -> list[float]:
    return await embed(f"Instruct: {_QUERY_INSTRUCTION}\nQuery: {text}", model, base_url, api_key)

_CLASSIFY_PROMPT = (
    "You are a content-safety classifier. The test: would someone sitting next to a "
    "stranger on a train be embarrassed if this image were on their screen? Answer "
    "\"yes\" (explicit, must be hidden) if ANY of these are visible:\n"
    "- Exposed nipples or areola, exposed genitalia (penis, vulva, etc.), or exposed anus.\n"
    "- Close-up shots showing genital detail, or genitals as the primary visual focus.\n"
    "- Sexual acts: penetration, intercourse, oral sex, masturbation, ejaculation or "
    "other sexual fluids.\n"
    "- A sexualized pose that exposes genitalia or anus (spread legs revealing "
    "genitalia, bent-over with exposure, a \"flashing\" pose, reclining with exposed "
    "genitalia, presenting).\n"
    "- Underwear/clothing pulled aside or down to expose genitals or nipples, or a "
    "complete absence of coverage over them.\n"
    "- Transparent/sheer material that reveals the actual color/detail of genitalia, "
    "nipples, or areola through the fabric (not just their outline/silhouette).\n"
    "- Underwear/panties shown prominently and deliberately in close, direct view "
    "(not a brief incidental glimpse under clothing or from a normal angle).\n"
    "- Graphic gore/violence: open wounds, dismemberment, blood pooling.\n"
    "Answer \"no\" (safe for anyone to see) for:\n"
    "- Clothed figures in suggestive poses with no skin exposure beyond the above.\n"
    "- Swimwear or underwear with full coverage of nipples and genitals, shown at a "
    "normal angle.\n"
    "- Opaque skintight/form-fitting outfits — even ones that outline the SHAPE of "
    "nipples/breasts through the fabric with no color or skin detail visible, that is "
    "just a silhouette, not exposure.\n"
    "- Cleavage, bare shoulders/midriff/thighs, kissing, non-graphic combat.\n"
    "- Non-sexual artistic/fashion/medical/educational nudity that doesn't expose "
    "genitalia, anus, nipples, or areola.\n"
    "When genuinely uncertain, answer \"no\", but do not use uncertainty as an excuse to "
    "wave through a shot that actually exposes the anatomy listed above or is "
    "deliberately sexualized. Answer with exactly two tokens separated by one space, no "
    "other text or punctuation: yes-or-no, then your confidence in that verdict as a "
    "whole number 0-100 (100 = certain). Example: \"no 92\" or \"yes 65\"."
)

async def classify_image_explicit(image_data_url: str, model: str,
                                  base_url: str = None, api_key: str = None) -> tuple[bool, int, str]:
    url = (_mk_root(base_url) if base_url else _root()) + "/chat/completions"
    payload = {
        "model": model.strip(),
        "stream": False,
        "temperature": 0,
        "max_tokens": 8,

        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": _CLASSIFY_PROMPT},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]}],
    }
    timeout = httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, headers=_headers(api_key), json=payload)
            resp.raise_for_status()
            j = resp.json()
        reply = ((j.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    except Exception as e:
        log.warning("nsfw vision classify failed: %s", e)
        return False, 0, f"<error: {e}>"
    parts = reply.strip().lower().split()
    explicit = bool(parts) and parts[0].startswith("yes")
    confidence = 0
    if len(parts) > 1:
        try:
            confidence = max(0, min(100, int(parts[1])))
        except ValueError:
            confidence = 0
    return explicit, confidence, reply

class ThinkSplitter:
    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self):
        self.in_think = False
        self.pending = ""

    def _channel(self):
        return "thinking" if self.in_think else "content"

    def _safe_keep(self):
        tag = self.CLOSE if self.in_think else self.OPEN
        for i in range(min(len(tag) - 1, len(self.pending)), 0, -1):
            if tag.startswith(self.pending[-i:]):
                return i
        return 0

    def feed(self, text):
        out = []
        self.pending += text
        while True:
            tag = self.CLOSE if self.in_think else self.OPEN
            idx = self.pending.find(tag)
            if idx != -1:
                before = self.pending[:idx]
                if before:
                    out.append((self._channel(), before))
                self.pending = self.pending[idx + len(tag):]
                self.in_think = not self.in_think
                continue
            keep = self._safe_keep()
            emit_len = len(self.pending) - keep
            if emit_len > 0:
                out.append((self._channel(), self.pending[:emit_len]))
                self.pending = self.pending[emit_len:]
            break
        return out

    def flush(self):
        out = []
        if self.pending:
            out.append((self._channel(), self.pending))
            self.pending = ""
        return out

async def chat_stream(messages, model, params=None, parse_think=False,
                      base_url: str = None, api_key: str = None, pin_host: bool = False):
    url = (_mk_root(base_url) if base_url else _root()) + "/chat/completions"
    headers = _headers(api_key)
    extensions = {}
    if pin_host and base_url:
        from backend import ssrf
        try:
            url, original_host = await ssrf.resolve_pinned_host(url)
        except ValueError as e:
            raise RuntimeError(f"chat endpoint became unsafe: {e}") from e
        if original_host:
            headers["Host"] = original_host
            extensions["sni_hostname"] = original_host
    payload = {"model": model.strip(), "messages": messages, "stream": True}
    payload.update(params or {})
    splitter = ThinkSplitter() if parse_think else None

    timeout = httpx.Timeout(connect=15.0, read=120.0, write=15.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        req = client.build_request("POST", url, headers=headers, json=payload, extensions=extensions)
        resp = await client.send(req, stream=True)
        try:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode()[:200]
                raise RuntimeError(f"chat endpoint {resp.status_code}: {detail}")
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    j = json.loads(data)
                except Exception as e:
                    log.warning("chat_stream: skipping malformed SSE chunk error=%s", e)
                    continue
                choices = j.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                rc = delta.get("reasoning_content")
                if rc:
                    yield ("thinking", rc)
                c = delta.get("content")
                if c:
                    if splitter:
                        for ev in splitter.feed(c):
                            yield ev
                    else:
                        yield ("content", c)
        finally:
            await resp.aclose()
    if splitter:
        for ev in splitter.flush():
            yield ev
