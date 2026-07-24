import pytest

from backend.repositories import notifications as notification_repo

pytestmark = pytest.mark.asyncio

def _admin_user() -> dict:
    return {"id": "u1", "username": "claude", "role": "admin"}

async def test_announce_rejects_empty_title(db_conn):
    from backend.routers.announcements import AnnounceIn, admin_announce

    body = AnnounceIn(title="   ", body="whatever")
    with pytest.raises(Exception) as exc_info:
        await admin_announce(body, _admin_user())
    assert exc_info.value.status_code == 400

async def test_announce_notifies_all_users_and_returns_sent_count(db_conn, monkeypatch):
    from backend.routers import announcements

    calls = []

    async def fake_notify_all_users(type, title, body="", link="", related_id=None, include_devs=False):
        calls.append({"type": type, "title": title, "body": body, "link": link, "include_devs": include_devs})
        return 7

    monkeypatch.setattr(announcements.notification_repo, "notify_all_users", fake_notify_all_users)
    body = announcements.AnnounceIn(title="Service degraded", body="Chat replies are slow, we are on it.")
    result = await announcements.admin_announce(body, _admin_user())
    assert result == {"sent": 7}
    assert len(calls) == 1
    assert calls[0]["type"] == "announcement"
    assert calls[0]["title"] == "Service degraded"
    assert calls[0]["body"] == "Chat replies are slow, we are on it."
    assert calls[0]["include_devs"] is True

async def test_notify_all_users_includes_devs_when_asked(db_conn, monkeypatch):
    from backend.repositories import notifications as repo

    created = []

    async def fake_create(user_id, type, title, body="", link="", related_id=None):
        created.append(user_id)
        return "nt"

    async def fake_non_dev():
        return ["u_user"]

    async def fake_all_active():
        return ["u_user", "u_dev"]

    monkeypatch.setattr(repo, "create", fake_create)
    monkeypatch.setattr(repo.user_repo, "list_active_non_dev_user_ids", fake_non_dev)
    monkeypatch.setattr(repo.user_repo, "list_active_user_ids", fake_all_active)
    sent_default = await repo.notify_all_users("announcement", "t")
    assert sent_default == 1
    assert created == ["u_user"]
    created.clear()
    sent_all = await repo.notify_all_users("announcement", "t", include_devs=True)
    assert sent_all == 2
    assert created == ["u_user", "u_dev"]

async def test_announce_strips_whitespace(db_conn, monkeypatch):
    from backend.routers import announcements

    calls = []

    async def fake_notify_all_users(type, title, body="", link="", related_id=None, include_devs=False):
        calls.append({"title": title, "body": body})
        return 1

    monkeypatch.setattr(announcements.notification_repo, "notify_all_users", fake_notify_all_users)
    body = announcements.AnnounceIn(title="  Restored  ", body="  All good now.  ")
    await announcements.admin_announce(body, _admin_user())
    assert calls[0]["title"] == "Restored"
    assert calls[0]["body"] == "All good now."
