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
# server.py resolves STATIC_DIR/MEDIA_DIR relative to the process cwd
# (./static, ./media) — uvicorn's --app-dir only affects where
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
# --reload-exclude modal_app/*: those files are never imported by server.py
# (they're deployed to Modal separately, see modal_provision.py) — without
# this, editing one mid-deploy triggers a full uvicorn worker reload that
# kills whatever `modal deploy` subprocess that same request just spawned,
# aborting the deploy with Modal's own "Stopping app - unknown reason".
# --reload-exclude /app/ai-frontend/.claude/worktrees: other agent sessions'
# isolated editing copies, never imported by server.py — without this, any
# concurrent agent's file edit anywhere in its own worktree triggers a full
# reload here too, cancelling in-flight chat generation (measured 45 reloads
# / 2 killed requests in 10 minutes) and, once, colliding with a startup
# ALTER TABLE migration and crashing the app outright. This MUST be the
# absolute path, not '.claude/worktrees' relative or a glob. uvicorn's
# FileFilter (uvicorn/supervisors/watchfilesreload.py) treats a
# --reload-exclude value as directory-scoped (recursively excluded via
# `dir in path.parents`) only when `Path(value).is_dir()` is true — that
# check passes for a relative value too (resolved against cwd), so it looks
# like it should work, but watchfiles reports changed files as *absolute*
# paths, and a relative Path is never equal to any element of an absolute
# path's .parents — so the relative form silently excluded nothing, and a
# glob form ('.claude/worktrees/*') separately failed for a different
# reason (Path.match() doesn't cross more than one directory level). Both
# were confirmed broken live before landing this absolute-path version.
# --timeout-graceful-shutdown 3: on --reload, uvicorn waits indefinitely for
# in-flight connections to close before restarting the worker. The
# multiplayer /live endpoint holds a long-lived SSE stream open for as long
# as anyone has a chat tab open, so it never closes on its own — a single
# active multiplayer viewer was enough to hang every single .py edit's
# reload forever, requiring a manual `podman restart story-game` each time.
# This caps the wait at 3 seconds before uvicorn force-closes stragglers and
# restarts anyway.
exec /app/ai-frontend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 3000 --reload --reload-exclude 'modal_app/*' --reload-exclude '/app/ai-frontend/.claude/worktrees' --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 3
