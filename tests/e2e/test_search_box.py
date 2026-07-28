import uuid
from playwright.sync_api import expect
from conftest import BASE_URL, login, api_login, api_client, E2E_MARKER


def test_explore_characters_pill_token_flow(browser):
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    char_resp = client.post("/api/characters", json={
        "name": f"Dragon Knight {marker}",
        "mode": "character",
        "greeting": "Hello.",
        "is_public": True,
        "tags": ["dragon"],
    })
    char_resp.raise_for_status()
    char_id = char_resp.json()["id"]
    try:
        page = browser.new_page()
        login(page, "test", "11111111")
        page.goto(f"{BASE_URL}/explore/characters")
        search = page.locator(".search-box-input")
        search.fill("#dragon")
        search.press("Enter")
        expect(page.locator(".inline-pill", has_text="#dragon")).to_be_visible()
        expect(page.locator("text=" + f"Dragon Knight {marker}")).to_be_visible()
        search.press("Backspace")
        expect(page.locator(".inline-pill", has_text="#dragon")).not_to_be_visible()
        page.close()
    finally:
        client.delete(f"/api/characters/{char_id}")
        client.close()


def test_forum_search_finds_thread_beyond_first_page(browser):
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    thread_resp = client.post("/api/forum/threads", json={
        "title": f"Unusual Zephyrwing Topic {marker}",
        "content": "body",
        "category": "general",
    })
    thread_resp.raise_for_status()
    thread_id = thread_resp.json()["id"]
    try:
        r = client.get("/api/forum/threads", params={"q": "Zephyrwing"})
        r.raise_for_status()
        ids = {t["id"] for t in r.json()}
        assert thread_id in ids
    finally:
        client.delete(f"/api/forum/threads/{thread_id}")
        client.close()
