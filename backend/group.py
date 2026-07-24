import re

_QUOTE_RE = re.compile(r'["“”]([^"“”]+)["“”]')

def split_speech(raw: str) -> tuple[str, str]:
    text = (raw or "").strip()
    dialogue = " ".join(m.group(1).strip() for m in _QUOTE_RE.finditer(text)).strip()
    action = _QUOTE_RE.sub(" ", text).replace("*", " ")
    action = re.sub(r"\s+", " ", action).strip(" \t-,;:.")
    if action and action[-1] not in ".!?":
        action += "."
    return dialogue, action

_NAME_TITLES = {"the", "a", "an", "de", "la", "le", "von", "van", "dr", "mr", "mrs", "ms", "sir", "lady", "lord", "miss"}
_TOKEN_SPLIT_RE = re.compile(r"[\s\-–—_,./]+")

def _name_variants(name: str) -> list[str]:
    name = (name or "").strip()
    if not name:
        return []
    variants = [name]
    for token in _TOKEN_SPLIT_RE.split(name):
        token = token.strip()
        if not token or token.lower() in _NAME_TITLES or len(token) < 2:
            continue
        variants.append(token)
        break
    seen, ordered = set(), []
    for variant in variants:
        key = variant.lower()
        if key not in seen:
            seen.add(key)
            ordered.append(variant)
    return ordered

def _find_mention(text: str, needle: str):
    if not needle:
        return None
    if needle.startswith("@") or not needle.isascii():
        match = re.search(re.escape(needle), text, re.IGNORECASE)
    else:
        match = re.search(r"\b" + re.escape(needle) + r"\b", text, re.IGNORECASE)
    return match.start() if match else None

def mentioned_speakers(text: str, cast: list[dict]) -> list[dict]:
    low = text or ""
    hits = []
    for member in cast:
        if member.get("is_narrator"):
            continue
        name = (member.get("name") or "").strip()
        char_id = (member.get("char_id") or member.get("id") or "").strip()
        needles = []
        if char_id:
            needles.append("@" + char_id)
        needles.extend(_name_variants(name))
        positions = [pos for pos in (_find_mention(low, needle) for needle in needles) if pos is not None]
        if positions:
            hits.append((min(positions), member))
    hits.sort(key=lambda pair: pair[0])
    return [member for _, member in hits]
