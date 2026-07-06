#!/bin/sh
# Entrypoint for the Personae/StoryHaven backend — set as the story-game
# container's own command, so a container restart brings uvicorn back
# automatically.
#
# The venv at /app/ai-frontend/venv is bind-mounted from the host, but its
# venv/bin/python3 is a SYMLINK to /usr/bin/python3.12 — that binary lives in
# the container's own (ephemeral) root filesystem, not in the bind mount, so
# a fresh/recreated container needs it reinstalled every time it's rebuilt
# from the base image. apk add is idempotent — instant no-op if already
# present (e.g. on a plain container restart rather than a rebuild).
if [ ! -x /usr/bin/python3.12 ]; then
  apk add --no-cache python3 >/tmp/apk.log 2>&1 || { cat /tmp/apk.log; exit 1; }
fi
# server.py resolves STATIC_DIR/MEDIA_DIR/DB_PATH relative to the process cwd
# (./static, ./media, ./personae.db) — uvicorn's --app-dir only affects where
# it imports the `server` module from, it does NOT chdir there. The compose
# service's working_dir is /app (shared with the sibling round-robin-story
# mount), so without this cd every relative path resolves one level too high.
cd /app/ai-frontend || exec echo "FATAL: /app/ai-frontend not mounted"
# --proxy-headers: trust X-Forwarded-Proto/-For from cloudflared so
# request.base_url reports https instead of http — otherwise og:url/og:image
# in the /c and /u share cards get generated with the wrong scheme and
# Discord/WhatsApp refuse to unfurl them.
# --forwarded-allow-ips='*': --proxy-headers only trusts X-Forwarded-Proto
# from 127.0.0.1 by default, but cloudflared reaches uvicorn over the
# sillytavern_net bridge network, not localhost, so the default trust list
# never matches it and the header gets ignored.
exec /app/ai-frontend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 3000 --reload --proxy-headers --forwarded-allow-ips='*'
