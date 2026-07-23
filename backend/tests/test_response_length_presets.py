from backend.sampling import RESPONSE_LENGTH_PRESETS, build_sampling_params


def test_all_presets_have_required_keys():
    for key, preset in RESPONSE_LENGTH_PRESETS.items():
        assert "label" in preset
        assert "emoji" in preset
        assert "max_tokens" in preset
        assert "instruction" in preset


def test_default_preset_has_no_override():
    assert RESPONSE_LENGTH_PRESETS["default"]["max_tokens"] is None
    assert RESPONSE_LENGTH_PRESETS["default"]["instruction"] == ""


def test_brief_preset_shorter_than_epic():
    assert RESPONSE_LENGTH_PRESETS["brief"]["max_tokens"] < RESPONSE_LENGTH_PRESETS["epic"]["max_tokens"]


def test_build_sampling_params_unaffected_by_presets_directly():
    params = build_sampling_params({"max_tokens": 1024})
    assert params["max_tokens"] == 1024
