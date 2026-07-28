import uuid
from conftest import BASE_URL, login, api_login, api_client, E2E_MARKER


def test_explore_characters_search_box_shows_filter_button_opens_drawer(browser):
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)

    char_resp = client.post("/api/characters", json={
        "name": f"Test Character {marker}",
        "mode": "rpg",
        "genre": "Fantasy",
        "greeting": "Welcome to the adventure.",
        "is_public": True,
    })
    char_resp.raise_for_status()
    char_id = char_resp.json()["id"]

    try:
        page = browser.new_page()
        login(page, "test", "11111111")
        page.goto(f"{BASE_URL}/explore/characters")
        page.wait_for_load_state("networkidle")

        filter_btn = page.locator(".search-box-filter-btn")
        page.wait_for_selector(".search-box-filter-btn", timeout=10000)
        assert filter_btn.count() > 0

        filter_btn.click()
        drawer = page.locator("#compendiumDrawer")
        page.wait_for_selector("#compendiumDrawer", timeout=5000)
        assert drawer.count() > 0

        page.close()
    finally:
        client.delete(f"/api/characters/{char_id}")
        client.close()
