import re
import time

SYSTEM_PROMPT_RETRIEVAL_PATTERNS = [
    re.compile(r"reveal\s+your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"print\s+your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"output\s+your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"show\s+(me\s+)?your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"what\s+(is|are)\s+your\s+(system\s+prompt|instructions)", re.I),
]

STRONG_PATTERNS = [
    re.compile(r"system\s+audit", re.I),
    re.compile(r"context\s+check", re.I),
    re.compile(r"acknowledge\s+all\s+context", re.I),
    re.compile(r"list\s+(of\s+)?all\s+(the\s+)?characters", re.I),
    re.compile(r"ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions", re.I),
    re.compile(r"disregard\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions", re.I),
    re.compile(r"\bdan\s+mode\b", re.I),
    re.compile(r"act\s+as\s+if\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)", re.I),
    re.compile(r"pretend\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)", re.I),
    re.compile(r"strictly\s+factual\s+to\s+the\s+(provided\s+)?card\s+data", re.I),
]

WEAK_PATTERNS = [
    re.compile(r"\bjailbreak\b", re.I),
    re.compile(r"\bsystem\s*:?\s*override\b", re.I),
    re.compile(r"bypass\s+(your\s+)?(filters?|restrictions?|guidelines?|safety)", re.I),
    re.compile(r"you\s+are\s+now\s+in\s+(developer|debug|admin)\s+mode", re.I),
]

WEAK_PATTERN_MIN_MATCHES = 2

BLOCKED_MESSAGE = ("Nice try. That reads like an attempt to override the AI's instructions with a fake "
                    "system command, so it wasn't sent, and now you're in a timeout. Use the /ooc "
                    "directive next time if you actually want to talk to it outside the story.")

TIMEOUT_SECONDS = 10
_violations: dict[str, float] = {}

def record_violation(user_id: str | None) -> None:
    if user_id:
        _violations[user_id] = time.time() + TIMEOUT_SECONDS

def remaining_timeout(user_id: str | None) -> float:
    if not user_id:
        return 0.0
    until = _violations.get(user_id)
    if not until:
        return 0.0
    remaining = until - time.time()
    if remaining <= 0:
        _violations.pop(user_id, None)
        return 0.0
    return remaining

class PromptInjectionBlocked(Exception):
    def __init__(self, retry_after: float):
        self.retry_after = retry_after
        super().__init__(BLOCKED_MESSAGE)

_NON_WORD_RE = re.compile(r"[^a-zA-Z0-9]+")
_FAKE_DIRECTIVE_RE = re.compile(r"[\[(]\s*(ooc|scene|note|time|as|roll)\s*:", re.I)
_REAL_DIRECTIVE_ROUTE_RE = re.compile(r"^\s*(/(ooc|scene|note|time|as|roll)\b|\{\s*(ooc|scene|note|time|as|roll)\s*:)", re.I)
_BARE_OOC_WORD_RE = re.compile(r"\booc\b", re.I)
_INLINE_REAL_DIRECTIVE_RE = re.compile(r"\{\s*(ooc|scene|note|time|as|roll)\s*:[^}]*\}", re.I)

def looks_like_prompt_injection(text: str) -> bool:
    raw = text or ""
    normalized = _NON_WORD_RE.sub(" ", raw).strip()
    if normalized and any(pattern.search(normalized) for pattern in SYSTEM_PROMPT_RETRIEVAL_PATTERNS):
        return True
    if _REAL_DIRECTIVE_ROUTE_RE.match(raw):
        return False
    without_directives = _INLINE_REAL_DIRECTIVE_RE.sub(" ", raw)
    if _FAKE_DIRECTIVE_RE.search(without_directives):
        return True
    if _BARE_OOC_WORD_RE.search(without_directives):
        return True
    if not normalized:
        return False
    if any(pattern.search(normalized) for pattern in STRONG_PATTERNS):
        return True
    weak_matches = sum(1 for pattern in WEAK_PATTERNS if pattern.search(normalized))
    return weak_matches >= WEAK_PATTERN_MIN_MATCHES

_REAL_DIRECTIVES = {"ooc", "scene", "note", "time", "as", "roll"}

def should_block_chat_message(content: str, directive: str | None) -> bool:
    raw = content or ""
    normalized = _NON_WORD_RE.sub(" ", raw).strip()
    if normalized and any(pattern.search(normalized) for pattern in SYSTEM_PROMPT_RETRIEVAL_PATTERNS):
        return True
    if directive in _REAL_DIRECTIVES:
        return False
    return looks_like_prompt_injection(raw)
