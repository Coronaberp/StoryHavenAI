RESERVED_FRACTION = 0.6


def estimate_tokens(text: str) -> int:
    return len(text) // 4 + 1


def _render(fact: dict) -> str:
    if fact.get("source") == "lore":
        suffix = f" (linked: {fact['link_label']})" if fact.get("link_label") else ""
        return f"- {fact['text']}{suffix}"
    if fact["fact_type"] == "state" and fact["valid_until_turn"] is None:
        return f"- {fact['text']} (ongoing)"
    if fact["valid_until_turn"] is not None:
        return f"- {fact['text']} (this later changed)"
    return f"- {fact['text']}"


def build_block(pinned: list[dict], active: list[dict], ranked: list[dict],
                budget_tokens: int) -> tuple[str, list[str], list[str]]:
    reserved_budget = int(budget_tokens * RESERVED_FRACTION)
    ordered_reserved = (sorted(pinned, key=lambda f: -f["importance"])
                        + sorted(active, key=lambda f: (-f["importance"], -f["last_turn"])))
    reserved_facts, used_ids, dropped_ids = [], [], []
    spent = 0
    for fact in ordered_reserved:
        line = _render(fact)
        cost = estimate_tokens(line)
        if spent + cost > reserved_budget:
            dropped_ids.append(fact["id"])
            continue
        reserved_facts.append(fact)
        used_ids.append(fact["id"])
        spent += cost
    scored_facts = []
    for fact in ranked:
        if fact["id"] in used_ids:
            continue
        line = _render(fact)
        cost = estimate_tokens(line)
        if spent + cost > budget_tokens:
            break
        scored_facts.append(fact)
        used_ids.append(fact["id"])
        spent += cost
    all_facts = reserved_facts + scored_facts
    lore_lines = [_render(f) for f in all_facts if f.get("source") == "lore"]
    pinned_lines = [_render(f) for f in reserved_facts if f.get("source") != "lore"]
    recalled_lines = [_render(f) for f in scored_facts if f.get("source") != "lore"]
    parts = []
    if lore_lines:
        parts.append("## Established world facts\n" + "\n".join(lore_lines))
    if pinned_lines:
        parts.append("## Ongoing & pinned\n" + "\n".join(pinned_lines))
    if recalled_lines:
        parts.append("## Recalled from earlier\n" + "\n".join(recalled_lines))
    if not parts:
        return "", [], dropped_ids
    return "\n\n".join(parts), used_ids, dropped_ids
