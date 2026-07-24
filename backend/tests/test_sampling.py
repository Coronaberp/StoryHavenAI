from backend.sampling import build_sampling_params, RESPONSE_LENGTH_PRESETS

def test_build_sampling_params_defaults():
    p = build_sampling_params({})
    assert p["temperature"] == 0.85
    assert p["top_p"] == 0.9
    assert p["max_tokens"] == 1024
    assert "top_k" not in p
    assert "mirostat_mode" not in p
    assert "seed" in p and 0 <= p["seed"] <= 2**31 - 1

def test_build_sampling_params_omits_neutral_optional_values():
    p = build_sampling_params({"top_k": 0, "min_p": 0.0, "repetition_penalty": 1.0})
    assert "top_k" not in p
    assert "min_p" not in p
    assert "repetition_penalty" not in p

def test_build_sampling_params_includes_non_neutral_optional_values():
    p = build_sampling_params({"top_k": 40, "min_p": 0.05, "repetition_penalty": 1.1})
    assert p["top_k"] == 40
    assert p["min_p"] == 0.05
    assert p["repetition_penalty"] == 1.1

def test_build_sampling_params_mirostat_only_when_mode_set():
    p = build_sampling_params({"mirostat_mode": 2, "mirostat_tau": 4.0, "mirostat_eta": 0.2})
    assert p["mirostat_mode"] == 2
    assert p["mirostat_tau"] == 4.0
    assert p["mirostat_eta"] == 0.2

    p2 = build_sampling_params({})
    assert "mirostat_mode" not in p2

def test_build_sampling_params_dynatemp_range():
    p = build_sampling_params({"dynatemp_low": 0.2, "dynatemp_high": 1.0})
    assert p["dynatemp_range"] == [0.2, 1.0]

def test_build_sampling_params_dry_settings():
    p = build_sampling_params({"dry_multiplier": 0.8})
    assert p["dry_multiplier"] == 0.8
    assert p["dry_base"] == 1.75
    assert p["dry_allowed_length"] == 2

def test_build_sampling_params_xtc_settings():
    p = build_sampling_params({"xtc_probability": 0.3, "xtc_threshold": 0.15})
    assert p["xtc_probability"] == 0.3
    assert p["xtc_threshold"] == 0.15

def test_build_sampling_params_explicit_seed_not_randomized():
    p = build_sampling_params({"seed": 42})
    assert p["seed"] == 42

def test_build_sampling_params_seed_none_omitted():
    p = build_sampling_params({"seed": None})
    assert "seed" not in p

def test_build_sampling_params_stop_sequences():
    p = build_sampling_params({"stop": ["\nUser:"]})
    assert p["stop"] == ["\nUser:"]

def test_build_sampling_params_extra_params_merged_last():
    p = build_sampling_params({"temperature": 0.5, "extra_params": {"temperature": 0.99, "custom_flag": True}})
    assert p["temperature"] == 0.99
    assert p["custom_flag"] is True

def test_response_length_presets_shape():
    for key, preset in RESPONSE_LENGTH_PRESETS.items():
        assert "label" in preset and "emoji" in preset and "max_tokens" in preset and "instruction" in preset
    assert RESPONSE_LENGTH_PRESETS["default"]["max_tokens"] is None
    assert RESPONSE_LENGTH_PRESETS["brief"]["max_tokens"] < RESPONSE_LENGTH_PRESETS["epic"]["max_tokens"]
