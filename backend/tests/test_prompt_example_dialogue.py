from backend.prompt import build_system, format_example_dialogue


def _char(dialogue, mode="character"):
    return {"name": "Kestrel", "persona": "", "scenario": "", "system_prompt": "",
            "dialogue": dialogue, "mode": mode, "assets": {}}


def test_format_example_dialogue_leaves_single_block_unchanged():
    text = '{{user}}: Hello.\n{{char}}: *smiles* Hello yourself.'
    assert format_example_dialogue(text) == text


def test_format_example_dialogue_splits_on_start_markers():
    text = (
        "<START>\n{{user}}: Hi.\n{{char}}: Hey there.\n"
        "<START>\n{{user}}: Bye.\n{{char}}: See you."
    )
    result = format_example_dialogue(text)
    assert "Example 1:" in result
    assert "Example 2:" in result
    assert "{{user}}: Hi." in result
    assert "{{user}}: Bye." in result
    assert "<START>" not in result


def test_format_example_dialogue_ignores_blank_segments():
    text = "<START>\n\n<START>\n{{user}}: Hi.\n{{char}}: Hey."
    result = format_example_dialogue(text)
    assert result == "{{user}}: Hi.\n{{char}}: Hey."


def test_build_system_formats_multi_example_dialogue():
    dialogue = "<START>\n{{user}}: Hi.\n{{char}}: Hey.\n<START>\n{{user}}: Bye.\n{{char}}: See you."
    system = build_system(_char(dialogue), None, "Alice", mode="character", full=True)
    assert "Example 1:" in system
    assert "Example 2:" in system
    assert "<START>" not in system
