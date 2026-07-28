from __future__ import annotations
import time

from sqlalchemy import select, distinct

from backend import db
from backend.db import sessions
from backend.repositories import characters as characters_repo
from backend.repositories import groups as groups_repo
from backend.repositories import content_likes as content_likes_repo
from backend.repositories import follows as follows_repo

WEIGHT_CHAT_HISTORY_EXACT = 0.5
WEIGHT_CHAT_HISTORY_CREATOR = 2.0
WEIGHT_LIKES_CREATOR = 2.0
WEIGHT_GENRE_AFFINITY = 1.5
WEIGHT_FOLLOWS = 1.0
FEATURED_RECENCY_HALFLIFE_DAYS = 14.0

async def _chatted_char_ids(user_id: str) -> set[str]:
    rows = await db._q(select(distinct(sessions.c.char_id)).where(sessions.c.user_id == user_id))
    return {r["char_id"] for r in rows if r["char_id"]}

async def _lookup_candidate(cid: str) -> dict | None:
    c = await characters_repo.get(cid)
    if c:
        return c
    return await groups_repo.get(cid)

async def build_user_signals(user_id: str) -> dict:
    liked = await content_likes_repo.list_liked_by_user(user_id)
    liked_ids = {r["target_id"] for r in liked if r["target_type"] in ("character", "group")}
    chatted_ids = await _chatted_char_ids(user_id)
    followed_creator_ids = set(await follows_repo.following_ids(user_id))

    liked_creator_ids: set[str] = set()
    affinity_genres: set[str] = set()
    for cid in liked_ids:
        candidate = await _lookup_candidate(cid)
        if not candidate:
            continue
        if candidate.get("owner_id"):
            liked_creator_ids.add(candidate["owner_id"])
        if candidate.get("genre"):
            affinity_genres.add(candidate["genre"])

    chatted_creator_ids: set[str] = set()
    for cid in chatted_ids:
        candidate = await characters_repo.get(cid)
        if not candidate:
            continue
        if candidate.get("owner_id"):
            chatted_creator_ids.add(candidate["owner_id"])
        if candidate.get("genre"):
            affinity_genres.add(candidate["genre"])

    return {
        "chatted_char_ids": chatted_ids,
        "chatted_creator_ids": chatted_creator_ids,
        "liked_creator_ids": liked_creator_ids,
        "affinity_genres": affinity_genres,
        "followed_creator_ids": followed_creator_ids,
        "has_signal": bool(chatted_ids or liked_ids or followed_creator_ids),
    }

def score_for_you(candidate: dict, signals: dict) -> float:
    score = 0.0
    owner_id = candidate.get("owner_id")
    if candidate.get("id") in signals["chatted_char_ids"]:
        score += WEIGHT_CHAT_HISTORY_EXACT
    elif owner_id and owner_id in signals["chatted_creator_ids"]:
        score += WEIGHT_CHAT_HISTORY_CREATOR
    if owner_id and owner_id in signals["liked_creator_ids"]:
        score += WEIGHT_LIKES_CREATOR
    if candidate.get("genre") and candidate["genre"] in signals["affinity_genres"]:
        score += WEIGHT_GENRE_AFFINITY
    if owner_id and owner_id in signals["followed_creator_ids"]:
        score += WEIGHT_FOLLOWS
    return score

def score_featured(candidate: dict, like_counts: dict[str, int], now: float | None = None) -> float:
    now = time.time() if now is None else now
    likes = like_counts.get(candidate.get("id"), 0)
    age_days = max(0.0, (now - (candidate.get("created") or now)) / 86400)
    recency = 2 ** (-age_days / FEATURED_RECENCY_HALFLIFE_DAYS)
    return likes + recency

async def rank_for_you(candidates: list[dict], user_id: str) -> tuple[list[dict], bool]:
    signals = await build_user_signals(user_id)
    if not signals["has_signal"]:
        return candidates, False
    ranked = sorted(candidates,
                    key=lambda c: (-score_for_you(c, signals), -(c.get("created") or 0)))
    return ranked, True

async def rank_featured(candidates: list[dict]) -> list[dict]:
    ids_by_kind: dict[str, list[str]] = {}
    for c in candidates:
        kind = c.get("kind") or "character"
        ids_by_kind.setdefault(kind, []).append(c["id"])
    like_counts: dict[str, int] = {}
    for kind, ids in ids_by_kind.items():
        like_counts.update(await content_likes_repo.like_counts_batch(kind, ids))
    now = time.time()
    return sorted(candidates, key=lambda c: -score_featured(c, like_counts, now))
