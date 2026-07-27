import re

from backend import db
from backend import vectors
from backend import llm
from backend.state import CFG, log
from backend.repositories import lore_chunks as lore_chunks_repo

LORE_CHUNK_THRESHOLD_TOKENS = 450
LORE_RECURSION_MAX_DEPTH = 2
LORE_RECURSION_MAX_ADDED = 20

def _estimate_tokens(text: str) -> int:
    return len(text) // 4 + 1

def _split_into_sentences(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s for s in sentences if s]

def _split_oversized_sentence(sentence: str, limit_tokens: int) -> list[str]:
    words = sentence.split(" ")
    if len(words) <= 1:
        limit_chars = limit_tokens * 4
        return [sentence[i:i + limit_chars] for i in range(0, len(sentence), limit_chars)] or [sentence]
    pieces: list[str] = []
    current: list[str] = []
    current_tokens = 0
    for word in words:
        word_tokens = _estimate_tokens(word)
        if current and current_tokens + word_tokens > limit_tokens:
            pieces.append(" ".join(current))
            current, current_tokens = [], 0
        current.append(word)
        current_tokens += word_tokens
    if current:
        pieces.append(" ".join(current))
    return pieces

def _pack_sentences(sentences: list[str], limit_tokens: int) -> list[str]:
    packed, current = [], []
    current_tokens = 0
    for sentence in sentences:
        sentence_tokens = _estimate_tokens(sentence)
        if sentence_tokens > limit_tokens:
            if current:
                packed.append(" ".join(current))
                current, current_tokens = [], 0
            packed.extend(_split_oversized_sentence(sentence, limit_tokens))
            continue
        if current and current_tokens + sentence_tokens > limit_tokens:
            packed.append(" ".join(current))
            current, current_tokens = [], 0
        current.append(sentence)
        current_tokens += sentence_tokens
    if current:
        packed.append(" ".join(current))
    return packed

def chunk_lore_content(content: str) -> list[str]:
    if _estimate_tokens(content) <= LORE_CHUNK_THRESHOLD_TOKENS:
        return [content]
    paragraphs = [p for p in content.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0
    for paragraph in paragraphs:
        paragraph_tokens = _estimate_tokens(paragraph)
        if paragraph_tokens > LORE_CHUNK_THRESHOLD_TOKENS:
            if current:
                chunks.append("\n\n".join(current))
                current, current_tokens = [], 0
            sentences = _split_into_sentences(paragraph)
            chunks.extend(_pack_sentences(sentences, LORE_CHUNK_THRESHOLD_TOKENS))
            continue
        if current and current_tokens + paragraph_tokens > LORE_CHUNK_THRESHOLD_TOKENS:
            chunks.append("\n\n".join(current))
            current, current_tokens = [], 0
        current.append(paragraph)
        current_tokens += paragraph_tokens
    if current:
        chunks.append("\n\n".join(current))
    return chunks

async def index_lore(lid, char_id, content, name: str = "", category: str = ""):
    try:
        prefix = ", ".join(p for p in (category, name) if p)
        chunks = chunk_lore_content(content)
        await lore_chunks_repo.delete_chunks(lid)
        await vectors.delete_lore_vector(lid)
        if len(chunks) == 1:
            embed_text = f"{prefix}: {content}" if prefix else content
            vec = await llm.embed(embed_text, CFG["embed_model"])
            await vectors.store_lore_vector(lid, char_id, vec, part_id=0)
            return
        embedded = 0
        for part_id, chunk in enumerate(chunks):
            embed_text = f"{prefix}: {chunk}" if prefix else chunk
            try:
                vec = await llm.embed(embed_text, CFG["embed_model"])
                await vectors.store_lore_vector(lid, char_id, vec, part_id=part_id)
                await lore_chunks_repo.insert_chunk(lid, part_id, chunk)
                embedded += 1
            except Exception as e:
                log.error("lore chunk embedding failed, chunk skipped: id=%s part=%s: %s",
                          lid, part_id, e)
        if embedded != len(chunks):
            log.error("lore indexing incomplete: id=%s chunks=%d embedded=%d — the missing "
                      "chunks are unreachable by semantic search until this entry is saved again",
                      lid, len(chunks), embedded)
    except Exception as e:
        log.warning("lore embedding failed for %s: %s", lid, e)

_CJK_RE = re.compile(r"[一-鿿぀-ヿ가-힯]")

def _key_in_text(key: str, text_lower: str) -> bool:
    key_lower = key.lower()
    if _CJK_RE.search(key_lower):
        return key_lower in text_lower
    return re.search(r"\b" + re.escape(key_lower) + r"\b", text_lower) is not None

def _entry_matches(e: dict, text_lower: str) -> bool:
    if not any(_key_in_text(k, text_lower) for k in e["keys"]):
        return False
    if e["require_keys"] and not all(_key_in_text(k, text_lower) for k in e["require_keys"]):
        return False
    if e["exclude_keys"] and any(_key_in_text(k, text_lower) for k in e["exclude_keys"]):
        return False
    return True

async def retrieve(char_id, session_id, query, recent, viewer_id: str | None = None) -> tuple[list[dict], None]:
    rt = (recent or "").lower()
    qt = (query or "").lower()
    entries = await db.list_lore(char_id, viewer_id)
    matched: dict[str, dict] = {}
    query_matched_ids: set[str] = set()
    for e in entries:
        if e["always"]:
            matched[e["id"]] = e
        elif _entry_matches(e, qt):
            matched[e["id"]] = e
            query_matched_ids.add(e["id"])
    for e in entries:
        if e["id"] in matched:
            continue
        if _entry_matches(e, rt):
            matched[e["id"]] = e
    direct_count = len(matched)

    scan_text = rt
    recursion_added = 0
    for _ in range(LORE_RECURSION_MAX_DEPTH):
        combined = scan_text + " " + " ".join(m["content"].lower() for m in matched.values() if not m["always"])
        added = False
        for e in entries:
            if recursion_added >= LORE_RECURSION_MAX_ADDED:
                break
            if e["id"] in matched:
                continue
            if _entry_matches(e, combined):
                matched[e["id"]] = e
                recursion_added += 1
                added = True
        if not added or recursion_added >= LORE_RECURSION_MAX_ADDED:
            break
        scan_text = combined

    ordered = [{**matched[eid], "query_matched": True} for eid in query_matched_ids]
    ordered.extend({**m, "query_matched": False}
                   for eid, m in matched.items() if eid not in query_matched_ids)
    log.info("lore retrieval: char=%s query_matched=%d direct=%d recursion_added=%d total=%d capped=%s",
             char_id, len(query_matched_ids), direct_count, recursion_added, len(matched),
             recursion_added >= LORE_RECURSION_MAX_ADDED)
    return ordered, None
