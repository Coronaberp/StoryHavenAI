import json

from backend import llm
from backend.db import nid
from backend.state import CFG, log
from backend.repositories import memory_facts
from backend.repositories import chat_sessions
from backend.memory_extraction import run_extract, run_reconcile
from backend import memory_ranking
from backend import memory_block
from backend import lore_memory
from backend.prompt import strip_think, recent_text

BATCH_SIZE = 5
SETTLE_MARGIN_EXCHANGES = 1
CATCHUP_MIN_PAIRS = 15
NEIGHBOR_K = 8
CANDIDATE_K = 32

def exchanges(msgs: list[dict], group: bool = False) -> list[tuple[dict, dict]]:
    out, pending_user = [], None
    for m in msgs:
        if m["role"] == "user":
            pending_user = m
        elif m["role"] == "assistant" and pending_user is not None:
            out.append((pending_user, m))
            if not group:
                pending_user = None
    return out

def current_turn(msgs: list[dict]) -> int:
    return sum(1 for m in msgs if m["role"] == "user")

def user_turn_ordinals(msgs: list[dict]) -> dict[str, int]:
    ordinals, count = {}, 0
    for m in msgs:
        if m["role"] == "user":
            count += 1
            ordinals[m["id"]] = count
    return ordinals

def present_participants(char_name: str, user_names: list[str], known_names: list[str],
                         recent: str) -> list[str]:
    lowered = (recent or "").lower()
    present = list(user_names) + [char_name]
    present += [n for n in known_names if n and n.lower() in lowered and n not in present]
    return present

def _transcript(batch: list[tuple[dict, dict]], char_name: str, user_name: str,
                names_by_id: dict | None = None,
                user_names_by_sender_id: dict | None = None) -> str:
    names_by_id = names_by_id or {}
    user_names_by_sender_id = user_names_by_sender_id or {}
    lines, prev_user_key = [], None
    for user_msg, assistant_msg in batch:
        if id(user_msg) != prev_user_key:
            sender_id = user_msg.get("sender_user_id")
            sender_name = user_names_by_sender_id.get(sender_id) or user_name
            lines.append(f"{sender_name}: {user_msg['content']}")
            prev_user_key = id(user_msg)
        speaker = names_by_id.get(assistant_msg.get("char_id")) or char_name
        char_line = f"{speaker}: {strip_think(assistant_msg['content'])}"
        mood = assistant_msg.get("mood")
        if mood:
            char_line += f" [mood: {mood}]"
        lines.append(char_line)
    return "\n".join(lines)

async def extract_batch(sid: str, char_id: str, char_name: str, user_name: str,
                        batch: list[tuple[dict, dict]], turn: int, language: str, model: str,
                        prev_session: dict, chat_base: str | None = None, chat_key: str | None = None,
                        embed_base: str | None = None, embed_key: str | None = None,
                        names_by_id: dict | None = None, cast_names: list[str] | None = None,
                        batch_id: str | None = None,
                        user_names_by_sender_id: dict | None = None) -> dict:
    log.info("memory extract start: session=%s turn=%s batch=%d exchanges group=%s",
             sid, turn, len(batch), bool(cast_names))
    drafts, char_state = await run_extract(_transcript(batch, char_name, user_name, names_by_id, user_names_by_sender_id),
                                           char_name, user_name, language, model, chat_base, chat_key,
                                           cast_names=cast_names)
    resolved_location = char_state.location or prev_session.get("char_location")
    try:
        known = set(json.loads(prev_session.get("known_names") or "[]"))
        known.update(char_state.npcs)
        await chat_sessions.set_char_state(
            sid,
            doing=char_state.doing or prev_session.get("char_doing"),
            location=resolved_location,
            known_names=sorted(known))
    except Exception as e:
        log.warning("character-state update failed for session %s turn %s: %s", sid, turn, e)
    stats = {"facts": len(drafts), "added": 0, "reinforced": 0, "superseded": 0}
    if not drafts:
        stats["lore_updates_applied"] = 0
        stats["secrets_revealed"] = 0
        log.info("memory extract done: session=%s turn=%s no facts", sid, turn)
        return stats
    vecs, neighbors = [], []
    for draft in drafts:
        vec = await llm.embed(draft.text, CFG["embed_model"],
                              base_url=embed_base, api_key=embed_key)
        vecs.append(vec)
        neighbors.append(await memory_facts.similar_current(sid, vec, NEIGHBOR_K))
    decisions = await run_reconcile(drafts, neighbors, model, chat_base, chat_key)
    for decision in decisions:
        draft, vec = drafts[decision.index], vecs[decision.index]
        fact = draft.model_dump()
        if fact["fact_type"] != "world" and not fact["participants"]:
            fact["participants"] = [user_name] + (cast_names or [char_name])
        fact.update(session_id=sid, char_id=char_id, turn=turn, location=resolved_location,
                   batch_id=batch_id)
        if decision.action == "add":
            await memory_facts.insert(fact, vec)
            stats["added"] += 1
        elif decision.action == "reinforce":
            await memory_facts.reinforce(decision.target_id, turn, batch_id=batch_id, session_id=sid)
            stats["reinforced"] += 1
        else:
            await memory_facts.supersede(decision.target_id, fact, vec, turn)
            stats["superseded"] += 1
    lore_stats = await lore_memory.detect_and_apply_lore_updates(
        sid, char_id, drafts, model, chat_base, chat_key, embed_base, embed_key)
    stats["lore_updates_applied"] = lore_stats["applied"]
    reveal_stats = await lore_memory.detect_and_reveal_secrets(
        sid, char_id, drafts, model, chat_base, chat_key, embed_base, embed_key)
    stats["secrets_revealed"] = reveal_stats["revealed"]
    log.info("memory extract done: session=%s turn=%s facts=%d added=%d reinforced=%d superseded=%d "
             "lore_updates=%d secrets_revealed=%d",
             sid, turn, stats["facts"], stats["added"], stats["reinforced"], stats["superseded"],
             stats["lore_updates_applied"], stats["secrets_revealed"])
    return stats

async def maybe_extract(session: dict, char: dict, user_name: str, language: str, model: str,
                        chat_base: str | None = None, chat_key: str | None = None,
                        embed_base: str | None = None, embed_key: str | None = None,
                        names_by_id: dict | None = None, cast_names: list[str] | None = None):
    sid = session["id"]
    msgs = await chat_sessions.list_messages(sid)
    pairs = exchanges(msgs, group=bool(names_by_id))
    settled = max(0, len(pairs) - SETTLE_MARGIN_EXCHANGES)
    cursor = await memory_facts.get_cursor(sid)
    ordinals = user_turn_ordinals(msgs)

    async def process(start: int, end: int):
        batch = pairs[start:end]
        turn = ordinals[batch[-1][0]["id"]]
        batch_id = nid("mebatch")
        await extract_batch(sid, char["id"], char["name"], user_name, batch, turn,
                            language, model, session, chat_base, chat_key, embed_base, embed_key,
                            names_by_id=names_by_id, cast_names=cast_names, batch_id=batch_id)
        await memory_facts.record_batch(sid, batch_id, start, end, turn)
        await memory_facts.set_cursor(sid, end)

    while settled - cursor >= BATCH_SIZE:
        await process(cursor, cursor + BATCH_SIZE)
        cursor += BATCH_SIZE
    if len(pairs) >= CATCHUP_MIN_PAIRS and settled - cursor >= 1:
        await process(cursor, settled)

async def rollback_discarded_turn(session_id: str, msgs: list[dict], message_id: str,
                                  names_by_id: dict | None = None) -> dict | None:
    pairs = exchanges(msgs, group=bool(names_by_id))
    pair_index = next((i for i, (_, assistant_msg) in enumerate(pairs)
                       if assistant_msg["id"] == message_id), None)
    if pair_index is None:
        return None
    result = await memory_facts.rollback_from_pair_index(session_id, pair_index)
    if result["batches_rolled_back"]:
        log.info("memory rollback triggered: session=%s message=%s batches=%d facts_deleted=%d "
                 "rewound_cursor=%s", session_id, message_id, result["batches_rolled_back"],
                 result["facts_deleted"], result["rewound_cursor"])
    return result

async def retrieve_block(session: dict, char: dict, user_name: str, query: str,
                         msgs: list[dict], cfg: dict, keyword_lore_entries: list[dict],
                         viewer_id: str | None = None,
                         embed_base: str | None = None,
                         embed_key: str | None = None) -> tuple[str, list[str], list[str], list[str]]:
    sid = session["id"]
    turn = current_turn(msgs)
    current_location = session.get("char_location")
    qvec = None
    if query:
        try:
            qvec = await llm.embed(query, CFG["embed_model"], base_url=embed_base, api_key=embed_key)
        except Exception as e:
            log.warning("memory v2 query embedding failed: session=%s error=%s", sid, e)
    lore_candidates = await lore_memory.fetch_lore_candidates(
        char["id"], sid, keyword_lore_entries, qvec, cfg, turn)
    if not query and not lore_candidates:
        return "", [], [], []
    known = json.loads(session.get("known_names") or "[]")
    present = present_participants(char["name"], [user_name], known, recent_text(msgs))
    present_lower = {p.lower() for p in present}
    candidates = []
    if qvec is not None:
        candidates = await memory_facts.similar_live(sid, qvec, CANDIDATE_K)
    guaranteed = await memory_facts.reserved(sid)
    pinned = [f for f in guaranteed if f.get("pinned")]
    present_and_unpinned = [f for f in guaranteed if not f.get("pinned")
                            and memory_ranking.participants_present(f, present_lower)]
    active_matching = [f for f in present_and_unpinned
                       if memory_ranking.is_active(f, current_location)]
    active_matching.sort(key=lambda f: (f["importance"], f["last_turn"]), reverse=True)
    active = active_matching[:memory_ranking.MAX_ACTIVE_RESERVED_FACTS]
    active_ids = {f["id"] for f in active}
    pinned_ids = {f["id"] for f in pinned}
    excluded_ids = active_ids | pinned_ids
    demoted = [f for f in present_and_unpinned if f["id"] not in active_ids]
    for fact in demoted:
        fact.setdefault("distance", 1.0)
        fact["demoted"] = True
    merged_candidates = {f["id"]: f for f in candidates if f["id"] not in excluded_ids}
    for fact in demoted:
        already_merged = merged_candidates.get(fact["id"])
        if already_merged is None:
            merged_candidates[fact["id"]] = fact
        else:
            already_merged["demoted"] = True
    ranked_memory = memory_ranking.rank(list(merged_candidates.values()), present, turn, current_location)
    lore_pinned = [c for c in lore_candidates if c["pinned"]]
    lore_scored = memory_ranking.rank(
        [c for c in lore_candidates if not c["pinned"]], present, turn, current_location)
    budget = int(cfg.get("memory_v2_budget_tokens") or 1000)
    block, used, dropped = memory_block.build_block(
        pinned + lore_pinned, active, ranked_memory + lore_scored, budget)
    if dropped:
        log.info("memory block overflow: session=%s dropped_reserved=%d", sid, len(dropped))
    used_set = set(used)
    meta_lore_lines = [memory_block._render(c) for c in lore_candidates if c["id"] in used_set]
    meta_memory_lines = [memory_block._render(f) for f in (pinned + active + ranked_memory)
                         if f["id"] in used_set]
    log.info("memory v2 retrieve: session=%s turn=%s memory_candidates=%d lore_candidates=%d used=%d",
             sid, turn, len(ranked_memory), len(lore_candidates), len(used))
    return block, used, meta_lore_lines, meta_memory_lines
