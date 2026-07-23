from backend import memory_block


def _lore(id_, text, importance=3, link_label=None):
    return {
        "id": id_, "source": "lore", "fact_type": "lore", "text": text,
        "importance": importance, "valid_until_turn": None, "last_turn": 1,
        "pinned": True, "link_label": link_label,
    }


def _memory(id_, text, pinned=False, fact_type="event", importance=3):
    return {
        "id": id_, "fact_type": fact_type, "text": text, "importance": importance,
        "valid_until_turn": None, "last_turn": 1, "pinned": pinned,
    }


def test_lore_lines_render_under_established_world_facts_heading():
    pinned = [_lore("l1", "The Sunken City lies beneath the bay.")]
    block, used, dropped = memory_block.build_block(pinned, [], [], budget_tokens=600)
    assert "## Established world facts" in block
    assert "The Sunken City lies beneath the bay." in block
    assert "l1" in used
    assert dropped == []


def test_lore_line_includes_link_label_when_present():
    pinned = [_lore("l1", "Chancellor Voss", link_label="leads")]
    block, _, _ = memory_block.build_block(pinned, [], [], budget_tokens=600)
    assert "leads" in block


def test_memory_pinned_lines_render_under_ongoing_and_pinned_heading():
    pinned = [_memory("m1", "Mira was stabbed", fact_type="state", pinned=True)]
    block, used, _ = memory_block.build_block(pinned, [], [], budget_tokens=600)
    assert "## Ongoing & pinned" in block
    assert "## Established world facts" not in block
    assert "m1" in used


def test_ranked_memory_lines_render_under_recalled_heading():
    ranked = [_memory("m2", "the player arrived in town")]
    block, used, _ = memory_block.build_block([], [], ranked, budget_tokens=600)
    assert "## Recalled from earlier" in block
    assert "m2" in used


def test_mixed_pool_renders_all_three_headings():
    pinned = [_lore("l1", "world fact"), _memory("m1", "pinned fact", fact_type="state", pinned=True)]
    ranked = [_memory("m2", "recalled fact")]
    block, used, _ = memory_block.build_block(pinned, [], ranked, budget_tokens=600)
    assert "## Established world facts" in block
    assert "## Ongoing & pinned" in block
    assert "## Recalled from earlier" in block
    assert set(used) == {"l1", "m1", "m2"}
