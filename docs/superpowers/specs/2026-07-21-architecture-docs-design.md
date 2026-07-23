# Architecture Docs & API Explorer Design

## Problem

There is no in-app way for a user or creator to actually learn how
StoryHaven AI works — the memory/lore system in particular has been
described this session as a "black box," and the platform's stated goal
(an open-source, full-featured alternative to SillyTavern) benefits
directly from being legible rather than opaque.

Separately, and more urgently: FastAPI's default Swagger UI is currently
live and completely unauthenticated. Confirmed directly against the
running app — `GET /docs` and `GET /openapi.json` both return `200` with
no session cookie required, exposing every endpoint (including admin-only
route shapes) to any anonymous visitor on the internet. This needs fixing
regardless of anything else in this design.

## 1. Security fix — close the current public exposure

`server.py`'s `FastAPI(title="StoryHaven AI", lifespan=lifespan)` becomes:

```python
app = FastAPI(title="StoryHaven AI", lifespan=lifespan, docs_url=None, openapi_url=None)
```

This disables the default public `/docs`, `/redoc`, and `/openapi.json`
entirely — no anonymous visitor can reach the schema at all after this
change, independent of anything else built in this design.

The schema is instead served from a new authenticated route:

```python
@api.get("/openapi-schema")
async def get_openapi_schema(_: dict = Depends(get_current_user)):
    return app.openapi()
```

`app.openapi()` is FastAPI's own schema-generation method — calling it
directly reuses the exact same schema FastAPI would have served publicly,
just now gated behind a real session.

## 2. Access model

Every logged-in user — regular, admin, and Dev alike — can view both the
architecture docs and the API explorer. This is a deliberate choice: the
goal is a platform that teaches people how it works, not a documentation
surface locked to operators only.

The API explorer only ever executes a request as the viewing user's own
real, authenticated session (the browser's existing session cookie carries
through automatically). Trying an admin-only endpoint as a regular user
returns a genuine `403` from the real backend — identical to what curl
would return with the same credentials. Seeing that an endpoint exists is
not the same as being able to use it; nothing new is exposed beyond what
"logged in" already implies.

## 3. Location

New route, `settings/docs`, added to `new_ui/js/router.js`'s existing
settings routes (alongside `settings`, `settings-appearance`,
`settings-model`, `settings-account`, `settings-blocks`) and to the
Settings sub-nav — matching this app's established settings-tab pattern
exactly. No new top-level nav concept, no separate section to discover.

## 4. Architecture docs content

New `new_ui/js/settings-docs.js` view. Content is hand-written,
plain-language prose explaining each subsystem — module map, the chat
flow, and (the primary motivating case) the memory/lore system's actual
mechanics: extraction, decay-weighted ranking, the reserved-tier caps,
chunking, lorebook matching. Written once, updated when a subsystem
meaningfully changes — the same maintenance model this project already
uses for `CLAUDE.md`.

Anywhere a concrete number would otherwise go stale in prose (current
feature flags and their on/off state, `memory_v2_budget_tokens`, the
current chunk-size/cap constants), the page fetches it live from the real
running config instead of hardcoding a number that could silently drift
from reality — reusing `GET /api/feature-status`-adjacent endpoints and a
small new read-only `GET /api/docs/live-config` endpoint
(`backend/routers/misc.py` or a new small module) that exposes only the
specific non-secret numeric constants the docs page references (never API
keys, URLs, or anything `PUBLIC_CFG_KEYS` doesn't already treat as
public-safe).

## 5. Architecture diagram

`mermaid.js` vendored into `new_ui/js/vendor/` (matching the existing
`gif-encoder.js` vendoring precedent in that directory — no CDN, no
runtime external dependency), rendered entirely client-side.

Two diagrams, both hand-maintained Mermaid definitions living in
`settings-docs.js` alongside the prose (same update-when-it-changes
maintenance model as section 4):

1. **Module map** — browser → `server.py` → `backend/routers/*` →
   `backend/repositories/*` → Postgres, mirroring the diagram already
   described in prose in this project's own `CLAUDE.md`.
2. **Memory/lore pipeline flow** — retrieval → ranking → chunking → budget
   packing, since that subsystem specifically is what this whole line of
   work has been about making legible.

Both render inline near the top of the architecture docs page, before the
prose sections — giving the reader the shape of the system at a glance
before the details.

## 6. API explorer

`swagger-ui-dist` vendored into `new_ui/js/vendor/`, served as its own
page reachable from the docs section, pointed at the new authenticated
`GET /api/openapi-schema` endpoint (section 1). Swagger UI's own
request-execution mechanism naturally carries the browser's existing
session cookie on every "try it out" call, so requests run as the real
logged-in user with their real permissions — no separate auth wiring
needed beyond what already exists.

Chosen over a custom-built explorer matching this app's exact visual
theme: Swagger UI is the standard, well-tested tool that does exactly what
"an API view (Swagger)" means, works correctly against a real OpenAPI
schema out of the box, and needs no new request-building/response-viewer
code. A visual mismatch with the rest of the app's theme is normal and
expected for a developer-tools-style page — same posture browsers take
toward their own devtools panel.

## 7. Idiot-proof framing

Both the docs page and the API explorer open with a short, plain-language
intro explaining what they're for and who benefits from them — "Curious
how StoryHaven actually works under the hood? Start here." /
"Want to see the raw API this app talks to? This is exactly what the
frontend itself calls." — not a bare technical dump with no orientation.
Consistent with the stated transparency goal, not just a checkbox
requirement.

## Non-goals

- No change to who can *use* any given endpoint — the API explorer changes
  visibility of what exists, never permission to call it.
- No auto-generated architecture prose. Content is hand-written and
  curated, same as this project's existing documentation conventions —
  only specific numeric facts are pulled live, not whole sections.
- No mobile-specific redesign of Swagger UI's own interface — it's used
  as-is, vendored unmodified, not re-themed or re-laid-out.
- No change to `PUBLIC_CFG_KEYS`'s existing public/private boundary — the
  new live-config endpoint in section 4 only ever exposes values already
  treated as safe to show a user, never secrets, API keys, or endpoint
  URLs.

## Testing

- `backend/tests/test_misc_router.py` or equivalent: `GET
  /api/openapi-schema` requires authentication (401 without a session,
  200 with one) and returns a real OpenAPI schema object (has `paths`,
  `info` keys).
- `backend/tests/test_server.py` or equivalent (new, if none covers app
  construction): confirm `docs_url`/`openapi_url` are `None` on the
  constructed `FastAPI` app instance, and that `GET /docs` and `GET
  /openapi.json` both now 404 unauthenticated (verifying the actual public
  exposure this design exists to close is actually closed).
- `backend/tests/test_docs_live_config.py` or equivalent (new): the
  live-config endpoint returns only the intended whitelisted keys, and a
  key not in that whitelist (e.g. anything from `api_key`/secret fields)
  is never present in the response regardless of what's in `CFG`.
- Live verification against the actual running app: confirm `GET /docs`
  and `GET /openapi.json` return 404 (not 200) post-deploy; confirm
  `settings/docs` renders both Mermaid diagrams and the Swagger UI page
  correctly for a logged-in non-admin test account; confirm a non-admin
  account attempting an admin-only endpoint through the Swagger "try it
  out" UI gets a real 403, not a fake/hidden control.
