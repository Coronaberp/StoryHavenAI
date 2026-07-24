import re

_DIALOGUE_RE = re.compile(r'"([^"]*)"|"([^"]*)"')
_OPEN_QUOTES = {'"', chr(0x201c)}
_CLOSE_QUOTES = {'"', chr(0x201d)}

def segment_speech(text: str) -> list[tuple[str, str]]:
    segments = []
    pos = 0
    for match in _DIALOGUE_RE.finditer(text):
        narration = text[pos:match.start()].strip()
        if narration:
            segments.append(("narration", narration))
        dialogue = (match.group(1) or match.group(2) or "").strip()
        if dialogue:
            segments.append(("dialogue", dialogue))
        pos = match.end()
    tail = text[pos:].strip()
    if not tail:
        return segments
    unclosed_quote_idx = -1
    for i, char in enumerate(tail):
        if char in _OPEN_QUOTES:
            unclosed_quote_idx = i
            break
    if unclosed_quote_idx >= 0:
        narration = tail[:unclosed_quote_idx].strip()
        if narration:
            segments.append(("narration", narration))
        dialogue = tail[unclosed_quote_idx + 1:].strip()
        if dialogue:
            segments.append(("dialogue", dialogue))
        return segments
    segments.append(("narration", tail))
    return segments
