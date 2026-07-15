"""Standalone dev server for new_ui/ — serves the static SPA with client-side
routing fallback and proxies /api/* to the already-running real backend
(the story-game container on :3000 by default). Never imports server.py or
runs any backend logic of its own — this process is fully decoupled from
the live app, on purpose."""
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "new_ui"
UPSTREAM_API = os.environ.get("UPSTREAM_API", "http://localhost:3000")

app = FastAPI()
_client = httpx.AsyncClient(base_url=UPSTREAM_API, timeout=30.0)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_api(request: Request, path: str):
    upstream_url = f"/api/{path}"
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
    upstream_response = await _client.request(
        request.method, upstream_url, content=body, headers=headers,
        params=request.query_params, cookies=request.cookies)
    excluded = {"content-encoding", "transfer-encoding", "connection"}
    response_headers = {k: v for k, v in upstream_response.headers.items() if k.lower() not in excluded}
    return Response(
        content=upstream_response.content, status_code=upstream_response.status_code,
        headers=response_headers)


def _is_spa_route(path: str) -> bool:
    return not os.path.splitext(path)[1] and not path.startswith("api/")


class _SpaStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as e:
            if e.status_code == 404 and _is_spa_route(path):
                return FileResponse(STATIC_DIR / "index.html")
            raise
        if response.status_code == 404 and _is_spa_route(path):
            return FileResponse(STATIC_DIR / "index.html")
        return response


app.mount("/", _SpaStaticFiles(directory=str(STATIC_DIR), html=True), name="static")
