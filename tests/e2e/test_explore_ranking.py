import uuid
from conftest import BASE_URL, login, api_login, api_client, E2E_MARKER


def test_explore_page_renders_for_you_and_featured_sections(browser):
    page = browser.new_page()
    login(page, "test", "11111111")
    page.goto(f"{BASE_URL}/explore")
    page.wait_for_selector("text=For You", timeout=10000)
    page.wait_for_selector("text=Featured", timeout=10000)
    body_text = page.inner_text("body")
    assert "For You" in body_text
    assert "Featured" in body_text
    page.close()


def test_for_you_and_featured_endpoints_respond():
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    try:
        for_you = client.get("/api/characters?scope=community&rank=for_you")
        for_you.raise_for_status()
        body = for_you.json()
        assert "items" in body and "personalized" in body

        featured = client.get("/api/characters?scope=community&rank=featured")
        featured.raise_for_status()
        body = featured.json()
        assert "items" in body
        assert body["personalized"] is False
    finally:
        client.close()


def test_liking_a_character_personalizes_for_you():
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    char_id = None
    try:
        char_resp = client.post("/api/characters", json={
            "name": f"E2E Ranking Character {marker}",
            "mode": "rpg",
            "greeting": "Hi.",
            "is_public": True,
            "genre": "Fantasy",
        })
        char_resp.raise_for_status()
        char_id = char_resp.json()["id"]

        before = client.get("/api/characters?scope=community&rank=for_you").json()
        assert before["personalized"] in (True, False)

        client.post(f"/api/character/{char_id}/like").raise_for_status()

        after = client.get("/api/characters?scope=community&rank=for_you").json()
        assert after["personalized"] is True
        ranked_ids = [c["id"] for c in after["items"]]
        assert char_id in ranked_ids
    finally:
        if char_id:
            client.delete(f"/api/characters/{char_id}")
        client.close()
