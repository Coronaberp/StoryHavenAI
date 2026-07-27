import re
import uuid
import httpx
from conftest import BASE_URL, api_login, api_client, E2E_MARKER


def _has_og_image(html):
    return bool(re.search(r'<meta property="og:image" content="[^"]+">', html))


def test_character_card_has_og_image():
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    char_resp = client.post("/api/characters", json={
        "name": f"E2E Card Character {marker}",
        "mode": "rpg",
        "greeting": "Welcome, traveler.",
        "is_public": True,
    })
    char_resp.raise_for_status()
    char_id = char_resp.json()["id"]
    try:
        with httpx.Client(base_url=BASE_URL, timeout=30.0) as anon:
            r = anon.get(f"/c/{char_id}")
        assert r.status_code == 200
        assert _has_og_image(r.text)
    finally:
        client.delete(f"/api/characters/{char_id}")
        client.close()


def test_group_card_has_og_image():
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    char_ids = []
    try:
        for i in range(2):
            char_resp = client.post("/api/characters", json={
                "name": f"E2E Card Member {i} {marker}",
                "mode": "character",
                "greeting": "Hello.",
                "is_public": True,
            })
            char_resp.raise_for_status()
            char_ids.append(char_resp.json()["id"])
        group_chat_resp = client.post("/api/group-chats", json={
            "name": f"E2E Card Group {marker}",
            "mode": "roleplay",
            "opening": "The story begins.",
            "char_ids": char_ids,
        })
        group_chat_resp.raise_for_status()
        session_id = group_chat_resp.json()["session_id"]
        publish_resp = client.post("/api/groups", json={"session_id": session_id})
        publish_resp.raise_for_status()
        group_id = publish_resp.json()["id"]
        with httpx.Client(base_url=BASE_URL, timeout=30.0) as anon:
            r = anon.get(f"/g/{group_id}")
        assert r.status_code == 200
        assert _has_og_image(r.text)
        client.delete(f"/api/sessions/{session_id}")
    finally:
        for char_id in char_ids:
            client.delete(f"/api/characters/{char_id}")
        client.close()


def test_shared_chat_card_has_og_image():
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    char_ids = []
    session_id = None
    try:
        for i in range(2):
            char_resp = client.post("/api/characters", json={
                "name": f"E2E Card Chat Member {i} {marker}",
                "mode": "character",
                "greeting": "Hello.",
                "is_public": True,
            })
            char_resp.raise_for_status()
            char_ids.append(char_resp.json()["id"])
        group_chat_resp = client.post("/api/group-chats", json={
            "name": f"E2E Card Live Chat {marker}",
            "mode": "roleplay",
            "opening": "The story begins.",
            "char_ids": char_ids,
        })
        group_chat_resp.raise_for_status()
        session_id = group_chat_resp.json()["session_id"]
        invite_resp = client.post(f"/api/sessions/{session_id}/multiplayer/invite-link")
        invite_resp.raise_for_status()
        token = invite_resp.json()["token"]
        with httpx.Client(base_url=BASE_URL, timeout=30.0) as anon:
            r = anon.get(f"/chats/{session_id}", params={"token": token})
        assert r.status_code == 200
        assert _has_og_image(r.text)
    finally:
        if session_id:
            client.delete(f"/api/sessions/{session_id}")
        for char_id in char_ids:
            client.delete(f"/api/characters/{char_id}")
        client.close()


def test_profile_card_has_og_image():
    with httpx.Client(base_url=BASE_URL, timeout=30.0) as anon:
        r = anon.get("/u/test")
    assert r.status_code == 200
    assert _has_og_image(r.text)


def test_image_card_has_og_image():
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    try:
        community = client.get("/api/imagegen/community").json()
        rows = community if isinstance(community, list) else community.get("images", [])
        if not rows:
            return
        image_id = rows[0]["id"]
        with httpx.Client(base_url=BASE_URL, timeout=30.0) as anon:
            r = anon.get(f"/i/{image_id}")
        assert r.status_code == 200
        assert _has_og_image(r.text)
    finally:
        client.close()


def test_docs_card_has_og_image():
    with httpx.Client(base_url=BASE_URL, timeout=30.0) as anon:
        r = anon.get("/settings-docs")
    assert r.status_code == 200
    assert _has_og_image(r.text)
