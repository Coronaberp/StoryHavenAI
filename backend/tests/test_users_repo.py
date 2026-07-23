import pytest

from backend.repositories import users as user_repo

pytestmark = pytest.mark.asyncio


async def test_create_get_user_roundtrip(db_conn):
    user = await user_repo.create_user("repo_test_user_1", "s3cret-password", is_admin=False)
    assert user["username"] == "repo_test_user_1"
    assert user["is_admin"] is False
    assert "password_hash" not in user

    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["id"] == user["id"]
    assert fetched["username"] == "repo_test_user_1"
    assert await user_repo.get_user_by_id("nonexistent") is None


async def test_get_user_by_username_includes_password_hash(db_conn):
    await user_repo.create_user("repo_test_user_2", "s3cret-password")
    row = await user_repo.get_user_by_username("repo_test_user_2")
    assert row is not None
    assert "password_hash" in row
    assert await user_repo.get_user_by_username("no_such_user_xyz") is None


async def test_update_user_role_and_status(db_conn):
    user = await user_repo.create_user("repo_test_user_3", "s3cret-password")
    await user_repo.update_user_role(user["id"], True)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["is_admin"] is True

    await user_repo.update_user_status(user["id"], "suspended")
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["status"] == "suspended"


async def test_set_dev_role_grant_and_revoke(db_conn):
    """The Dev tier (routers/admin.py's get_dev dependency, admin-core.js's
    isDev) replaced a hardcoded username check with this role column — a new
    user defaults to role='user', an admin defaults to 'admin', and only an
    explicit set_dev_role call grants/revokes the 'dev' tier on top."""
    user = await user_repo.create_user("repo_test_dev_user", "s3cret-password", is_admin=True)
    assert user["role"] == "user"

    await user_repo.set_dev_role(user["id"], True)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["role"] == "dev"
    assert fetched["is_admin"] is True

    await user_repo.set_dev_role(user["id"], False)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["role"] == "admin"
    assert fetched["is_admin"] is True  # revoking Dev never demotes the admin itself


async def test_suspend_and_unsuspend_user(db_conn):
    user = await user_repo.create_user("repo_test_user_4", "s3cret-password")
    await user_repo.suspend_user(user["id"], "breaking the rules")
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["status"] == "suspended"
    assert fetched["suspension_reason"] == "breaking the rules"

    await user_repo.unsuspend_user(user["id"])
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["status"] == "active"
    assert fetched["suspension_reason"] is None


async def test_update_user_password_changes_verification(db_conn):
    from backend import db
    user = await user_repo.create_user("repo_test_user_5", "old-password-123")
    await user_repo.update_user_password(user["id"], "new-password-456")
    row = await user_repo.get_user_by_username("repo_test_user_5")
    assert not db.verify_password("old-password-123", row["password_hash"])
    assert db.verify_password("new-password-456", row["password_hash"])


async def test_access_token_whitelist_lifecycle(db_conn):
    user = await user_repo.create_user("repo_test_user_6", "s3cret-password")
    jti = "test-jti-1"
    await user_repo.whitelist_access_token(jti, user["id"])
    assert await user_repo.access_token_valid(jti, user["id"]) is True

    await user_repo.revoke_access_token(jti)
    assert await user_repo.access_token_valid(jti, user["id"]) is False


async def test_refresh_token_whitelist_lifecycle(db_conn):
    user = await user_repo.create_user("repo_test_user_6b", "s3cret-password")
    jti = "test-jti-refresh-1"
    await user_repo.whitelist_refresh_token(jti, user["id"])
    assert await user_repo.refresh_token_valid(jti, user["id"]) is True

    await user_repo.revoke_refresh_token(jti)
    assert await user_repo.refresh_token_valid(jti, user["id"]) is False


async def test_revoke_user_tokens_keeps_current_pair(db_conn):
    user = await user_repo.create_user("repo_test_user_7", "s3cret-password")
    keep_access, other_access = "keep-access", "other-access"
    keep_refresh, other_refresh = "keep-refresh", "other-refresh"
    await user_repo.whitelist_access_token(keep_access, user["id"])
    await user_repo.whitelist_access_token(other_access, user["id"])
    await user_repo.whitelist_refresh_token(keep_refresh, user["id"])
    await user_repo.whitelist_refresh_token(other_refresh, user["id"])

    await user_repo.revoke_user_tokens(
        user["id"], keep_access_jti=keep_access, keep_refresh_jti=keep_refresh)

    assert await user_repo.access_token_valid(keep_access, user["id"]) is True
    assert await user_repo.access_token_valid(other_access, user["id"]) is False
    assert await user_repo.refresh_token_valid(keep_refresh, user["id"]) is True
    assert await user_repo.refresh_token_valid(other_refresh, user["id"]) is False


async def test_delete_user_removes_tokens_and_settings(db_conn):
    user = await user_repo.create_user("repo_test_user_8", "s3cret-password")
    jti = "test-jti-delete"
    await user_repo.whitelist_access_token(jti, user["id"])
    await user_repo.set_user_settings(user["id"], {"chat_model": "some-model"})

    await user_repo.delete_user(user["id"])

    assert await user_repo.get_user_by_id(user["id"]) is None
    assert await user_repo.access_token_valid(jti, user["id"]) is False
    assert await user_repo.get_user_settings(user["id"]) == {}


async def test_user_settings_roundtrip_and_api_key_encryption(db_conn):
    user = await user_repo.create_user("repo_test_user_9", "s3cret-password")
    await user_repo.set_user_settings(user["id"], {
        "base_url": "http://example.com/v1",
        "api_key": "sk-super-secret",
    })
    settings = await user_repo.get_user_settings(user["id"])
    assert settings["base_url"] == "http://example.com/v1"
    assert settings["api_key"] == "sk-super-secret"

    await user_repo.set_user_settings(user["id"], {"base_url": None})
    settings = await user_repo.get_user_settings(user["id"])
    assert "base_url" not in settings


async def test_clear_user_settings(db_conn):
    user = await user_repo.create_user("repo_test_user_10", "s3cret-password")
    await user_repo.set_user_settings(user["id"], {"chat_model": "x"})
    await user_repo.clear_user_settings(user["id"])
    assert await user_repo.get_user_settings(user["id"]) == {}


async def test_set_identity_label(db_conn):
    user = await user_repo.create_user("repo_test_user_11", "s3cret-password")
    await user_repo.set_identity_label(user["id"], "known troublemaker")
    rows = await user_repo.list_users()
    row = next(r for r in rows if r["id"] == user["id"])
    assert row["identity_label"] == "known troublemaker"

    await user_repo.set_identity_label(user["id"], None)
    rows = await user_repo.list_users()
    row = next(r for r in rows if r["id"] == user["id"])
    assert row["identity_label"] is None


async def test_list_admin_user_ids(db_conn):
    admin = await user_repo.create_user("repo_test_admin_1", "s3cret-password", is_admin=True)
    regular = await user_repo.create_user("repo_test_user_12", "s3cret-password", is_admin=False)
    ids = await user_repo.list_admin_user_ids()
    assert admin["id"] in ids
    assert regular["id"] not in ids


async def test_any_users_true_when_rows_exist(db_conn):
    await user_repo.create_user("repo_test_user_13", "s3cret-password")
    assert await user_repo.any_users() is True


async def test_update_user_profile_encrypts_fields(db_conn):
    user = await user_repo.create_user("repo_test_user_14", "s3cret-password")
    await user_repo.update_user_profile(user["id"], {
        "display_name": "Cool Name",
        "bio": "a bio about me",
        "social_links": {"twitter": "handle"},
    })
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["display_name"] == "Cool Name"
    assert fetched["bio"] == "a bio about me"
    assert fetched["social_links"] == {"twitter": "handle"}


async def test_totp_secret_roundtrip_and_stripped_from_user_row(db_conn):
    user = await user_repo.create_user("repo_test_totp_1", "s3cret-password")
    assert "totp_secret" not in user
    assert user["totp_enabled"] is False

    await user_repo.set_totp_secret(user["id"], "JBSWY3DPEHPK3PXP")
    assert await user_repo.get_totp_secret(user["id"]) == "JBSWY3DPEHPK3PXP"

    fetched = await user_repo.get_user_by_id(user["id"])
    assert "totp_secret" not in fetched
    assert fetched["totp_enabled"] is False


async def test_totp_enabled_flag(db_conn):
    user = await user_repo.create_user("repo_test_totp_2", "s3cret-password")
    await user_repo.set_totp_enabled(user["id"], True)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["totp_enabled"] is True

    await user_repo.set_totp_enabled(user["id"], False)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["totp_enabled"] is False


async def test_admin_clear_totp_route_resets_account_to_sfa(db_conn):
    from backend.routers.admin import admin_clear_user_totp

    user = await user_repo.create_user("repo_test_totp_clear", "s3cret-password")
    await user_repo.set_totp_secret(user["id"], "JBSWY3DPEHPK3PXP", ["aaaa1111", "bbbb2222"])
    await user_repo.set_totp_enabled(user["id"], True)
    await user_repo.set_totp_login_required(user["id"], True)

    admin = {"id": "admin-totp-clear-1", "username": "admin", "is_admin": True}
    result = await admin_clear_user_totp(user["id"], current_user=admin)

    assert result["totp_enabled"] is False
    assert result["totp_login_required"] is False
    assert await user_repo.get_totp_secret(user["id"]) is None

    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["totp_enabled"] is False
    assert fetched["totp_login_required"] is False


async def test_admin_clear_totp_route_404_for_missing_user(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_clear_user_totp

    admin = {"id": "admin-totp-clear-2", "username": "admin", "is_admin": True}
    with pytest.raises(HTTPException) as exc_info:
        await admin_clear_user_totp("nonexistent-uid", current_user=admin)

    assert exc_info.value.status_code == 404


async def test_totp_backup_codes_roundtrip_and_consume(db_conn):
    user = await user_repo.create_user("repo_test_totp_3", "s3cret-password")
    await user_repo.set_totp_secret(user["id"], "JBSWY3DPEHPK3PXP", ["aaaa1111", "bbbb2222"])
    codes = await user_repo.get_totp_backup_codes(user["id"])
    assert set(codes) == {"aaaa1111", "bbbb2222"}

    assert await user_repo.consume_totp_backup_code(user["id"], "aaaa1111") is True
    remaining = await user_repo.get_totp_backup_codes(user["id"])
    assert remaining == ["bbbb2222"]

    assert await user_repo.consume_totp_backup_code(user["id"], "aaaa1111") is False


async def test_set_totp_secret_none_clears_secret_and_backup_codes(db_conn):
    user = await user_repo.create_user("repo_test_totp_4", "s3cret-password")
    await user_repo.set_totp_secret(user["id"], "JBSWY3DPEHPK3PXP", ["aaaa1111"])
    await user_repo.set_totp_secret(user["id"], None)
    assert await user_repo.get_totp_secret(user["id"]) is None
    assert await user_repo.get_totp_backup_codes(user["id"]) == []


async def test_totp_login_required_independent_of_totp_enabled(db_conn):
    user = await user_repo.create_user("repo_test_totp_5", "s3cret-password")
    assert user["totp_login_required"] is False

    await user_repo.set_totp_secret(user["id"], "JBSWY3DPEHPK3PXP")
    await user_repo.set_totp_enabled(user["id"], True)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["totp_enabled"] is True
    assert fetched["totp_login_required"] is False

    await user_repo.set_totp_login_required(user["id"], True)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["totp_login_required"] is True


async def test_disabling_totp_clears_login_required(db_conn):
    user = await user_repo.create_user("repo_test_totp_6", "s3cret-password")
    await user_repo.set_totp_secret(user["id"], "JBSWY3DPEHPK3PXP")
    await user_repo.set_totp_enabled(user["id"], True)
    await user_repo.set_totp_login_required(user["id"], True)

    await user_repo.set_totp_enabled(user["id"], False)
    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["totp_enabled"] is False
    assert fetched["totp_login_required"] is False


async def test_rotate_refresh_token_marks_used_not_deleted(db_conn):
    user = await user_repo.create_user("repo_test_rotate_1", "s3cret-password")
    jti = "rotate-jti-1"
    await user_repo.whitelist_refresh_token(jti, user["id"])

    await user_repo.rotate_refresh_token(jti)

    assert await user_repo.refresh_token_valid(jti, user["id"]) is False
    row = await user_repo.get_refresh_token(jti, user["id"])
    assert row is not None
    assert row["revoked"] == 1


async def test_get_refresh_token_distinguishes_unknown_from_revoked(db_conn):
    user = await user_repo.create_user("repo_test_rotate_2", "s3cret-password")
    assert await user_repo.get_refresh_token("never-issued-jti", user["id"]) is None

    jti = "rotate-jti-2"
    await user_repo.whitelist_refresh_token(jti, user["id"])
    row = await user_repo.get_refresh_token(jti, user["id"])
    assert row["revoked"] == 0

    await user_repo.revoke_refresh_token(jti)
    row = await user_repo.get_refresh_token(jti, user["id"])
    assert row is not None
    assert row["revoked"] == 1


async def test_list_active_non_dev_user_ids_excludes_dev_and_inactive(db_conn):
    non_dev_user = await user_repo.create_user("repo_test_non_dev_1", "s3cret-password")
    dev_user = await user_repo.create_user("repo_test_dev_1", "s3cret-password", is_admin=True)
    await user_repo.set_dev_role(dev_user["id"], True)
    inactive_user = await user_repo.create_user("repo_test_inactive_1", "s3cret-password")
    await user_repo.update_user_status(inactive_user["id"], "suspended")

    ids = await user_repo.list_active_non_dev_user_ids()

    assert non_dev_user["id"] in ids
    assert dev_user["id"] not in ids
    assert inactive_user["id"] not in ids
    assert isinstance(ids, list)
    assert all(isinstance(i, str) for i in ids)


async def test_set_user_experimental_features_enabled(db_conn):
    user = await user_repo.create_user("repo_test_experimental_1", "s3cret-password")
    assert user["experimental_features_enabled"] is False
    updated = await user_repo.set_user_experimental_features_enabled(user["id"], True)
    assert updated["experimental_features_enabled"] is True
    reverted = await user_repo.set_user_experimental_features_enabled(user["id"], False)
    assert reverted["experimental_features_enabled"] is False
