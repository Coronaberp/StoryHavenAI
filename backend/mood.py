"""Character mood-tag parsing — the trailing [mood: X] tag a character with
stage/music/sprite assets is asked to append to each reply."""
import re

MOOD_RE = re.compile(r"\[mood:\s*([a-z0-9 _\-]+)\]\s*$", re.I)


def character_moods(char):
    a = char.get("assets") or {}
    moods = set()
    for sect in ("stage", "music", "sprites"):
        moods.update((a.get(sect) or {}).get("moods", {}).keys())
    return sorted(moods)


def parse_mood(text, moods):
    text = text or ""
    m = MOOD_RE.search(text)
    if not m:
        return text.strip(), None
    clean = text[:m.start()].strip()
    cand = m.group(1).strip().lower()
    low = {mo.lower(): mo for mo in moods}
    mood = low.get(cand, cand)
    return clean, mood
