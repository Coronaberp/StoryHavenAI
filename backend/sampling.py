RESPONSE_LENGTH_PRESETS = {
    "brief": {"label": "Brief", "emoji": "✂️", "max_tokens": 180,
              "instruction": "Keep this reply brief: two to four sentences, no more."},
    "short": {"label": "Short", "emoji": "📝", "max_tokens": 400,
              "instruction": "Keep this reply short: a compact paragraph or two."},
    "default": {"label": "Default", "emoji": "🎚️", "max_tokens": None, "instruction": ""},
    "long": {"label": "Long", "emoji": "📖", "max_tokens": 1400,
             "instruction": "Write a longer, more developed reply with room for scene detail."},
    "epic": {"label": "Epic", "emoji": "📜", "max_tokens": 2600,
             "instruction": "Write an extensive, richly detailed reply — take your time with the scene."},
}

def build_sampling_params(cfg: dict) -> dict:
    g = lambda k, d: cfg.get(k, d)
    p = {"temperature": g("temperature", 0.85), "top_p": g("top_p", 0.9), "max_tokens": g("max_tokens", 1024)}
    add = lambda key, val, neutral: p.__setitem__(key, val) if val not in (None, neutral) else None
    add("frequency_penalty", g("frequency_penalty", 0.0), 0.0)
    add("presence_penalty", g("presence_penalty", 0.0), 0.0)
    if g("stop", []):
        p["stop"] = g("stop", [])
    if isinstance(g("extra_params", {}), dict) and g("extra_params", {}):
        p.update(g("extra_params", {}))
    return p
