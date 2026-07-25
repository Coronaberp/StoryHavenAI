import re

PROMPT_INJECTION_PATTERNS = [
    re.compile(r"system\s+audit", re.I),
    re.compile(r"context\s+check", re.I),
    re.compile(r"acknowledge\s+all\s+context", re.I),
    re.compile(r"list\s+(of\s+)?all\s+(the\s+)?characters", re.I),
    re.compile(r"ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions", re.I),
    re.compile(r"disregard\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions", re.I),
    re.compile(r"reveal\s+your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"print\s+your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"output\s+your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"what\s+(is|are)\s+your\s+(system\s+prompt|instructions)", re.I),
    re.compile(r"you\s+are\s+now\s+in\s+(developer|debug|admin)\s+mode", re.I),
    re.compile(r"\bdan\s+mode\b", re.I),
    re.compile(r"\bjailbreak\b", re.I),
    re.compile(r"\bsystem\s*:?\s*override\b", re.I),
    re.compile(r"bypass\s+(your\s+)?(filters?|restrictions?|guidelines?|safety)", re.I),
    re.compile(r"act\s+as\s+if\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)", re.I),
    re.compile(r"pretend\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)", re.I),
    re.compile(r"strictly\s+factual\s+to\s+the\s+(provided\s+)?card\s+data", re.I),
]

BLOCKED_MESSAGE = ("That message wasn't sent because it reads like an attempt to override the AI's "
                    "instructions with a fake system command. Use the /ooc directive to talk to it "
                    "outside the story instead.")

def looks_like_prompt_injection(text: str) -> bool:
    normalized = " ".join((text or "").split())
    if not normalized:
        return False
    return any(pattern.search(normalized) for pattern in PROMPT_INJECTION_PATTERNS)
