from backend import db
from backend import llm
from backend import vectors
from backend.state import CFG, log
from backend.repositories import lore_chunks
from backend.repositories import lore_links
from backend.repositories import lore_secrets
from backend.repositories import memory_facts
from backend.repositories import session_lore_state
from backend.memory_extraction import run_lore_update_detection, run_secret_reveal_detection

LORE_CANDIDATE_K = 32
NEIGHBOR_K = 3
MAX_PINNED_LORE_CHUNKS = 12


def lore_candidate(entry: dict, current_turn: int, distance: float = 0.0,
                   pinned: bool = False, link_label: str | None = None,
                   candidate_id: str | None = None, content: str | None = None) -> dict:
    return {
        "id": candidate_id or entry["id"], "source": "lore", "fact_type": "lore",
        "text": content if content is not None else entry["content"],
        "participants": [], "importance": entry.get("importance", 3), "valence": 0,
        "reinforcements": 0, "pinned": pinned, "valid_until_turn": None,
        "last_turn": current_turn, "distance": distance, "link_label": link_label,
    }


async def _expand_entry_candidates(entry: dict, overrides: dict, current_turn: int,
                                   pinned: bool, distance: float = 0.0,
                                   link_label: str | None = None) -> list[dict]:
    if entry["id"] in overrides:
        return [lore_candidate(entry, current_turn, distance, pinned, link_label,
                               content=overrides[entry["id"]])]
    chunks = await lore_chunks.chunks_for(entry["id"])
    if not chunks:
        return [lore_candidate(entry, current_turn, distance, pinned, link_label)]
    return [lore_candidate(entry, current_turn, distance, pinned, link_label,
                           candidate_id=f"{entry['id']}#{chunk['part_id']}",
                           content=chunk["content"])
            for chunk in chunks]


async def _resolve_hit_candidate(hit: dict, entry: dict, overrides: dict,
                                 current_turn: int) -> dict | None:
    lore_id = hit["lore_id"]
    if lore_id in overrides:
        return lore_candidate(entry, current_turn, hit["distance"], content=overrides[lore_id])
    chunks = await lore_chunks.chunks_for(lore_id)
    if not chunks:
        return lore_candidate(entry, current_turn, hit["distance"]) if hit["part_id"] == 0 else None
    if hit["part_id"] == 0:
        return lore_candidate(entry, current_turn, hit["distance"],
                              candidate_id=f"{lore_id}#0", content=chunks[0]["content"])
    chunk = next((c for c in chunks if c["part_id"] == hit["part_id"]), None)
    if not chunk:
        return None
    return lore_candidate(entry, current_turn, hit["distance"],
                          candidate_id=f"{lore_id}#{hit['part_id']}", content=chunk["content"])


async def _append_semantic_hits(candidates: list[dict], seen_ids: set[str], char_id: str,
                                query_vec, overrides: dict, cfg: dict, current_turn: int) -> None:
    chunk_hits = await vectors.search_lore_chunks(
        char_id, query_vec, LORE_CANDIDATE_K, cfg.get("lore_max_dist", CFG["lore_max_dist"]))
    new_hits = [h for h in chunk_hits if h["lore_id"] not in seen_ids]
    hit_lore_ids = {h["lore_id"] for h in new_hits}
    if not hit_lore_ids:
        return
    knn_entries = {e["id"]: e for e in await db.lore_by_ids(list(hit_lore_ids))}
    for hit in new_hits:
        entry = knn_entries.get(hit["lore_id"])
        if not entry:
            continue
        candidate = await _resolve_hit_candidate(hit, entry, overrides, current_turn)
        if candidate:
            candidates.append(candidate)
        seen_ids.add(hit["lore_id"])


async def fetch_lore_candidates(char_id: str, session_id: str, keyword_entries: list[dict],
                                query_vec, cfg: dict, current_turn: int) -> list[dict]:
    overrides = await session_lore_state.get_all_overrides_for_session(session_id)
    seen_ids = {e["id"] for e in keyword_entries}
    pinned_candidates: list[dict] = []
    for e in keyword_entries:
        pinned_candidates.extend(await _expand_entry_candidates(e, overrides, current_turn, pinned=True))
    pinned_candidates.sort(key=lambda c: c["importance"], reverse=True)
    active_pinned = pinned_candidates[:MAX_PINNED_LORE_CHUNKS]
    demoted_pinned = [dict(c, pinned=False) for c in pinned_candidates[MAX_PINNED_LORE_CHUNKS:]]
    candidates = list(active_pinned)
    if query_vec is not None:
        await _append_semantic_hits(candidates, seen_ids, char_id, query_vec, overrides, cfg, current_turn)
    candidates.extend(demoted_pinned)
    expand_ids = [c["id"].split("#")[0] for c in candidates]
    if expand_ids:
        outgoing = await lore_links.outgoing_for_many(expand_ids)
        incoming = await lore_links.incoming_for_many(expand_ids)
        neighbor_labels: dict[str, str] = {}
        for links in outgoing.values():
            for link in links:
                if link["target_id"] not in seen_ids:
                    neighbor_labels.setdefault(link["target_id"], link["label"])
        for links in incoming.values():
            for link in links:
                if link["source_id"] not in seen_ids:
                    neighbor_labels.setdefault(link["source_id"], link["label"])
        if neighbor_labels:
            neighbor_entries = await db.lore_by_ids(list(neighbor_labels))
            for e in neighbor_entries:
                if e.get("char_id") and e["char_id"] != char_id:
                    continue
                candidates.append(lore_candidate(
                    {**e, "content": overrides.get(e["id"], e["content"])},
                    current_turn, link_label=neighbor_labels[e["id"]] or None))
                seen_ids.add(e["id"])
    return candidates


async def apply_session_lore_override(session_id: str, char_id: str, lore_id: str, content: str) -> str:
    vec = await llm.embed(content, CFG["embed_model"])
    existing = await session_lore_state.get_state(session_id, lore_id)
    if existing and existing.get("override_fact_id"):
        await memory_facts.update_text(existing["override_fact_id"], content, vec)
        fact_id = existing["override_fact_id"]
    else:
        fact_id = await memory_facts.insert({
            "session_id": session_id, "char_id": char_id, "text": content,
            "fact_type": "state", "participants": [], "importance": 5, "valence": 0, "turn": 0,
        }, vec, pinned=True)
    await session_lore_state.set_override(session_id, lore_id, content, fact_id)
    return fact_id


async def detect_and_apply_lore_updates(session_id: str, char_id: str, drafts: list,
                                        model: str, chat_base: str | None, chat_key: str | None,
                                        embed_base: str | None, embed_key: str | None) -> dict:
    stats = {"checked": len(drafts), "applied": 0}
    if not drafts:
        return stats
    lore_neighbors = []
    for draft in drafts:
        try:
            vec = await llm.embed(draft.text, CFG["embed_model"], base_url=embed_base, api_key=embed_key)
            ids = await vectors.search_lore_ids(char_id, vec, NEIGHBOR_K, CFG["lore_max_dist"])
            entries = await db.lore_by_ids(ids) if ids else []
            lore_neighbors.append([{"id": e["id"], "text": e["content"]} for e in entries])
        except Exception as e:
            log.warning("lore-update neighbor search failed session=%s: %s: %s",
                        session_id, type(e).__name__, e)
            lore_neighbors.append([])
    decisions = await run_lore_update_detection(drafts, lore_neighbors, model, chat_base, chat_key)
    for decision in decisions:
        try:
            await apply_session_lore_override(session_id, char_id, decision.lore_id, decision.new_content)
            stats["applied"] += 1
            log.info("lore_memory: session-scoped override applied session=%s lore=%s",
                     session_id, decision.lore_id)
        except Exception as e:
            log.warning("lore-update apply failed session=%s lore=%s: %s: %s",
                        session_id, decision.lore_id, type(e).__name__, e)
    return stats


async def apply_secret_reveal(session_id: str, char_id: str, secret_id: str, secret_text: str,
                              embed_base: str | None = None, embed_key: str | None = None) -> None:
    await lore_secrets.reveal(session_id, secret_id)
    try:
        vec = await llm.embed(secret_text, CFG["embed_model"], base_url=embed_base, api_key=embed_key)
        await memory_facts.insert({
            "session_id": session_id, "char_id": char_id, "text": secret_text,
            "fact_type": "event", "participants": [], "importance": 4, "valence": 0, "turn": 0,
        }, vec)
    except Exception as e:
        log.warning("lore_memory: secret-reveal memory enrichment failed session=%s secret=%s: %s: %s",
                    session_id, secret_id, type(e).__name__, e)


async def detect_and_reveal_secrets(session_id: str, char_id: str, drafts: list,
                                    model: str, chat_base: str | None, chat_key: str | None,
                                    embed_base: str | None, embed_key: str | None) -> dict:
    stats = {"checked": len(drafts), "revealed": 0}
    if not drafts:
        return stats
    secret_neighbors = []
    for draft in drafts:
        try:
            vec = await llm.embed(draft.text, CFG["embed_model"], base_url=embed_base, api_key=embed_key)
            lore_ids = await vectors.search_lore_ids(char_id, vec, NEIGHBOR_K, CFG["lore_max_dist"])
            candidates = []
            for lid in lore_ids:
                secrets = await lore_secrets.secrets_for(lid)
                if not secrets:
                    continue
                revealed = await lore_secrets.revealed_ids(session_id, [s["id"] for s in secrets])
                candidates.extend({"id": s["id"], "text": s["text"]}
                                  for s in secrets if s["id"] not in revealed)
            secret_neighbors.append(candidates)
        except Exception as e:
            log.warning("secret-reveal neighbor search failed session=%s: %s: %s",
                        session_id, type(e).__name__, e)
            secret_neighbors.append([])
    decisions = await run_secret_reveal_detection(drafts, secret_neighbors, model, chat_base, chat_key)
    id_to_text = {n["id"]: n["text"] for near in secret_neighbors for n in near}
    for decision in decisions:
        try:
            await apply_secret_reveal(session_id, char_id, decision.secret_id,
                                      id_to_text[decision.secret_id], embed_base, embed_key)
            stats["revealed"] += 1
            log.info("lore_memory: secret revealed session=%s secret=%s",
                     session_id, decision.secret_id)
        except Exception as e:
            log.warning("secret-reveal apply failed session=%s secret=%s: %s: %s",
                        session_id, decision.secret_id, type(e).__name__, e)
    return stats
