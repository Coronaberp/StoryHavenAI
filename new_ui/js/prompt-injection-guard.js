"use strict";

const SYSTEM_PROMPT_RETRIEVAL_PATTERNS = [
  /reveal\s+your\s+(system\s+prompt|instructions)/i,
  /print\s+your\s+(system\s+prompt|instructions)/i,
  /output\s+your\s+(system\s+prompt|instructions)/i,
  /show\s+(me\s+)?your\s+(system\s+prompt|instructions)/i,
  /what\s+(is|are)\s+your\s+(system\s+prompt|instructions)/i,
];

const STRONG_INJECTION_PATTERNS = [
  /system\s+audit/i,
  /context\s+check/i,
  /acknowledge\s+all\s+context/i,
  /list\s+(of\s+)?all\s+(the\s+)?characters/i,
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i,
  /\bdan\s+mode\b/i,
  /act\s+as\s+if\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)/i,
  /pretend\s+you\s+(have\s+)?no\s+(restrictions|filters|guidelines)/i,
  /strictly\s+factual\s+to\s+the\s+(provided\s+)?card\s+data/i,
];

const WEAK_INJECTION_PATTERNS = [
  /\bjailbreak\b/i,
  /\bsystem\s*:?\s*override\b/i,
  /bypass\s+(your\s+)?(filters?|restrictions?|guidelines?|safety)/i,
  /you\s+are\s+now\s+in\s+(developer|debug|admin)\s+mode/i,
];

const WEAK_PATTERN_MIN_MATCHES = 2;
const FAKE_DIRECTIVE_RE = /[\[(]\s*(ooc|scene|note|time|as|roll)\s*:/i;
const REAL_DIRECTIVE_ROUTE_RE = /^\s*(\/(ooc|scene|note|time|as|roll)\b|\{\s*(ooc|scene|note|time|as|roll)\s*:)/i;
const BARE_OOC_WORD_RE = /\booc\b/i;

function looksLikePromptInjection(text) {
  const raw = text || "";
  const normalized = raw.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (normalized && SYSTEM_PROMPT_RETRIEVAL_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (REAL_DIRECTIVE_ROUTE_RE.test(raw)) return false;
  if (FAKE_DIRECTIVE_RE.test(raw)) return true;
  if (BARE_OOC_WORD_RE.test(raw)) return true;
  if (!normalized) return false;
  if (STRONG_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const weakMatches = WEAK_INJECTION_PATTERNS.filter((pattern) => pattern.test(normalized)).length;
  return weakMatches >= WEAK_PATTERN_MIN_MATCHES;
}

if (typeof window !== "undefined") {
  window.looksLikePromptInjection = looksLikePromptInjection;
}
