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


async def test_auth_session_lifecycle(db_conn):
    user = await user_repo.create_user("repo_test_user_6", "s3cret-password")
    token = await user_repo.create_auth_session(user["id"])
    assert token

    session_user = await user_repo.get_session_user(token)
    assert session_user["id"] == user["id"]

    await user_repo.delete_auth_session(token)
    assert await user_repo.get_session_user(token) is None


async def test_delete_other_user_sessions_keeps_current_token(db_conn):
    user = await user_repo.create_user("repo_test_user_7", "s3cret-password")
    keep = await user_repo.create_auth_session(user["id"])
    other = await user_repo.create_auth_session(user["id"])

    await user_repo.delete_other_user_sessions(user["id"], keep_token=keep)

    assert await user_repo.get_session_user(keep) is not None
    assert await user_repo.get_session_user(other) is None


async def test_delete_user_removes_auth_sessions_and_settings(db_conn):
    user = await user_repo.create_user("repo_test_user_8", "s3cret-password")
    token = await user_repo.create_auth_session(user["id"])
    await user_repo.set_user_settings(user["id"], {"chat_model": "some-model"})

    await user_repo.delete_user(user["id"])

    assert await user_repo.get_user_by_id(user["id"]) is None
    assert await user_repo.get_session_user(token) is None
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
