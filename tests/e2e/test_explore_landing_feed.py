import uuid
from conftest import BASE_URL, login, api_login, api_client, E2E_MARKER


def test_explore_landing_shows_unified_for_you_feed(browser):
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)

    char_resp = client.post("/api/characters", json={
        "name": f"E2E Feed Character {marker}",
        "mode": "rpg",
        "greeting": "Hello there.",
        "is_public": True,
    })
    char_resp.raise_for_status()
    char_id = char_resp.json()["id"]

    thread_resp = client.post("/api/forum/threads", json={
        "title": f"E2E Feed Thread {marker}",
        "content": "A thread created for the explore landing feed test.",
        "category": "",
    })
    thread_resp.raise_for_status()
    thread_id = thread_resp.json()["id"]

    try:
        page = browser.new_page()
        login(page, "test", "11111111")
        page.goto(f"{BASE_URL}/explore")
        page.wait_for_selector(".foryou-feed", timeout=10000)

        active_tab = page.locator(".explore-tab.active")
        assert active_tab.count() == 1
        assert active_tab.inner_text().strip() == "For You"
        assert page.locator(".foryou-feed").is_visible()

        for_you_chip = page.locator(".feed-chip[data-feed='foryou']")
        trending_chip = page.locator(".feed-chip[data-feed='trending']")
        assert "on" in for_you_chip.get_attribute("class")

        char_count = page.locator(".foryou-feed .char-card").count()
        assert char_count >= 1

        mixed_count = (
            page.locator(".foryou-feed .char-card").count()
            + page.locator(".foryou-feed .thread-card").count()
            + page.locator(".foryou-feed .pin-frame").count()
            + page.locator(".foryou-feed .creator-card").count()
        )
        assert mixed_count > char_count

        trending_chip.click()
        page.wait_for_function(
            "() => document.querySelector(\".feed-chip[data-feed='trending']\").classList.contains('on')",
            timeout=5000,
        )
        assert "on" not in for_you_chip.get_attribute("class")
        assert page.locator(".foryou-feed").is_visible()
        page.close()
    finally:
        client.delete(f"/api/forum/threads/{thread_id}")
        client.delete(f"/api/characters/{char_id}")
        client.close()
