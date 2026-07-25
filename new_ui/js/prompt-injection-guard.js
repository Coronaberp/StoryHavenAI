"use strict";

const PROMPT_INJECTION_PATTERNS = [
  /system\s+audit/i,
  /context\s+check/i,
  /acknowledge\s+all\s+context/i,
  /list\s+(of\s+)?all\s+(the\s+)?characters/i,
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i,
  /reveal\s+your\s+(system\s+prompt|instructions)/i,
  /print\s+your\s+(system\s+prompt|instructions)/i,
  /output\s+your\s+(system\s+prompt|instructions)/i,
  /what\s+(is|are)\s+your\s+(system\s+prompt|instructions)/i,
  /you\s+are\s+now\s+in\s+(developer|debug|admin)\s+mode/i,
  /\bdan\s+mode\b/i,
  /\bjailbreak\b/i,
  /\bsystem\s*:?\s*override\b/i,
  /bypass\s+(your\s+)?(filters?|restrictions?|guidelines?|safety)/i,
  /act\s+as\s+if\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)/i,
  /pretend\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)/i,
  /strictly\s+factual\s+to\s+the\s+(provided\s+)?card\s+data/i,
];

function looksLikePromptInjection(text) {
  const normalized = (text || "").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!normalized) return false;
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

if (typeof window !== "undefined") {
  window.looksLikePromptInjection = looksLikePromptInjection;
}
