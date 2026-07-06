"""
llm.py — talks to any OpenAI-compatible server (Ollama's /v1, LM Studio,
llama.cpp, vLLM, OpenAI itself, ...).

Base-URL resolution mirrors the provided C# BuildOpenAiCompatibleModelsEndpoint:
we tolerate a base that already ends in /chat/completions, /models, /v1, or
/api/v1, and otherwise append /v1. Everything else is derived from that root.

chat_stream and embed accept optional base_url / api_key overrides so that
per-user LLM endpoints are supported without touching the module-level config.
"""
import json
import httpx

_base = "http://llamacpp-chat:5001/v1"
_embed_base = "http://llamacpp-embed:5002/v1"
_key = ""
_embed_key = ""


def configure(base_url: str, api_key: str = "", embed_url: str = None,
              embed_key: str = None):
    """embed_url/embed_key are optional; fall back to base_url/api_key when unset."""
    global _base, _key, _embed_base, _embed_key
    _base, _key = base_url, api_key or ""
    _embed_base = embed_url or base_url
    _embed_key = embed_key if embed_key is not None else ""


def _mk_root(base: str) -> str:
    """Normalize a chat base URL to the OpenAI API root."""
    b = base.strip().rstrip("/")
    if b.endswith("/chat/completions"):
        b = b[: -len("/chat/completions")]
    if b.endswith("/models"):
        b = b[: -len("/models")]
    if b.endswith("/v1") or b.endswith("/api/v1"):
        return b
    return b + "/v1"


def _mk_root_embed(base: str) -> str:
    """Normalize an embedding base URL to the OpenAI API root."""
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
    """Build chat auth headers. api_key=None → use module-level key; api_key="" → no auth."""
    k = api_key if api_key is not None else _key
    return {"Authorization": f"Bearer {k}"} if k else {}


def _headers_embed(api_key=None) -> dict:
    """Build embed auth headers using the separate embed key."""
    k = api_key if api_key is not None else _embed_key
    return {"Authorization": f"Bearer {k}"} if k else {}


async def list_models(base_url: str = None, api_key: str = None) -> list[str]:
    url = (_mk_root(base_url) if base_url else _root()) + "/models"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers(api_key))
        resp.raise_for_status()
        data = resp.json().get("data", [])
    return [m.get("id") for m in data if m.get("id")]


async def embed(text: str, model: str,
                base_url: str = None, api_key: str = None) -> list[float]:
    """Embed text. base_url/api_key override the module-level config when set."""
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


class ThinkSplitter:
    """
    Splits a streamed text into ('thinking', ...) and ('content', ...) chunks by
    detecting <think>...</think> tags that may be split across stream deltas.
    """
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
                      base_url: str = None, api_key: str = None):
    """
    Async generator yielding (channel, text) where channel is 'content' or
    'thinking'. base_url/api_key override the module-level config when set.
    """
    url = (_mk_root(base_url) if base_url else _root()) + "/chat/completions"
    payload = {"model": model.strip(), "messages": messages, "stream": True}
    payload.update(params or {})
    splitter = ThinkSplitter() if parse_think else None
    # No overall timeout (generation can legitimately take a while), but a
    # bounded read timeout matters: without one, a connection that goes dead
    # silently (no RST — common on some network paths/NATs) hangs forever
    # waiting for a chunk that will never arrive, with no exception ever
    # raised for _run's error handling to catch — the client just sees the
    # stream stall with no terminal event. 120s of total silence between
    # chunks is generous for any real generation still in progress.
    timeout = httpx.Timeout(connect=15.0, read=120.0, write=15.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=_headers(api_key), json=payload) as resp:
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
                except Exception:
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
    if splitter:
        for ev in splitter.flush():
            yield ev
