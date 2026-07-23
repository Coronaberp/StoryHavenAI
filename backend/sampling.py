"""LLM sampling parameter construction from user/global config."""
import random

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
    add("top_k", g("top_k", 0), 0)
    add("min_p", g("min_p", 0.0), 0.0)
    add("top_a", g("top_a", 0.0), 0.0)
    add("typical_p", g("typical_p", 1.0), 1.0)
    add("tfs", g("tfs", 1.0), 1.0)
    add("repetition_penalty", g("repetition_penalty", 1.0), 1.0)
    add("repetition_penalty_range", g("repetition_penalty_range", 0), 0)
    add("frequency_penalty", g("frequency_penalty", 0.0), 0.0)
    add("presence_penalty", g("presence_penalty", 0.0), 0.0)
    add("smoothing_factor", g("smoothing_factor", 0.0), 0.0)
    if g("mirostat_mode", 0):
        p["mirostat_mode"] = g("mirostat_mode", 0)
        p["mirostat_tau"] = g("mirostat_tau", 5.0)
        p["mirostat_eta"] = g("mirostat_eta", 0.1)
    if g("dynatemp_low", 0.0) or g("dynatemp_high", 0.0):
        p["dynatemp_low"] = g("dynatemp_low", 0.0)
        p["dynatemp_high"] = g("dynatemp_high", 0.0)
        p["dynatemp_range"] = [g("dynatemp_low", 0.0), g("dynatemp_high", 0.0)]
    if g("dry_multiplier", 0.0):
        p["dry_multiplier"] = g("dry_multiplier", 0.0)
        p["dry_base"] = g("dry_base", 1.75)
        p["dry_allowed_length"] = g("dry_allowed_length", 2)
    if g("xtc_probability", 0.0):
        p["xtc_threshold"] = g("xtc_threshold", 0.1)
        p["xtc_probability"] = g("xtc_probability", 0.0)
    # -1 conventionally means "randomize" in llama.cpp/koboldcpp, but not every
    # OpenAI-compatible backend agrees — some (e.g. DeepSeek's hosted API)
    # validate seed as an unsigned int and reject -1 outright with a 400.
    # Generating an actual random non-negative seed here works everywhere:
    # backends that support seeding get a fresh value every call (so
    # regenerate doesn't silently return the same cached output), and strict
    # validators never see a value they'd reject.
    seed = g("seed", -1)
    if seed is not None:
        p["seed"] = random.randint(0, 2**31 - 1) if seed == -1 else seed
    if g("stop", []):
        p["stop"] = g("stop", [])
    if isinstance(g("extra_params", {}), dict) and g("extra_params", {}):
        p.update(g("extra_params", {}))
    return p
