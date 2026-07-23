import pytest

from backend.oauth_registry import PROVIDER_REGISTRY, extract_user_id

REQUIRED_KEYS = {"label", "protocol", "authorize_url", "scope", "user_id_field"}
OAUTH2_STANDARD_KEYS = {"token_url", "userinfo_url"}


def test_every_provider_has_required_keys():
    for name, entry in PROVIDER_REGISTRY.items():
        missing = REQUIRED_KEYS - entry.keys()
        assert not missing, f"{name} missing keys: {missing}"


def test_standard_oauth2_providers_have_token_and_userinfo_urls():
    for name, entry in PROVIDER_REGISTRY.items():
        if entry["protocol"] == "oauth2":
            missing = OAUTH2_STANDARD_KEYS - entry.keys()
            assert not missing, f"{name} missing keys: {missing}"


def test_scope_never_requests_email():
    for name, entry in PROVIDER_REGISTRY.items():
        assert "email" not in entry["scope"].lower(), f"{name} scope requests email: {entry['scope']}"


def test_expected_providers_present():
    expected = {"google", "facebook", "github", "discord", "twitter",
                "reddit", "steam", "apple", "microsoft"}
    assert expected == set(PROVIDER_REGISTRY.keys())


def test_extract_user_id_flat_field():
    assert extract_user_id("google", {"sub": "12345"}) == "12345"


def test_extract_user_id_dotted_path():
    assert extract_user_id("twitter", {"data": {"id": "67890"}}) == "67890"


def test_extract_user_id_missing_returns_none():
    assert extract_user_id("google", {"other": "field"}) is None


def test_extract_user_id_unknown_provider_returns_none():
    assert extract_user_id("not-a-provider", {"sub": "x"}) is None
