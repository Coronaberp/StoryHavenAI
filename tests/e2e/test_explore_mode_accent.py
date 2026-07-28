import uuid
from playwright.sync_api import expect
from conftest import BASE_URL, login, api_login, api_client, E2E_MARKER


def test_character_mode_badges_and_colors(browser):
    marker_rpg = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    marker_char = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"

    cookie = api_login("test", "11111111")
    client = api_client(cookie)

    rpg_resp = client.post("/api/characters", json={
        "name": f"RPG Character {marker_rpg}",
        "mode": "rpg",
        "genre": "Fantasy",
        "greeting": "Greetings, adventurer.",
        "is_public": True,
    })
    rpg_resp.raise_for_status()
    rpg_char_id = rpg_resp.json()["id"]

    char_resp = client.post("/api/characters", json={
        "name": f"Chat Character {marker_char}",
        "mode": "character",
        "genre": "Modern/Realistic",
        "greeting": "Hey there!",
        "is_public": True,
    })
    char_resp.raise_for_status()
    char_char_id = char_resp.json()["id"]

    try:
        page = browser.new_page()
        login(page, "test", "11111111")
        page.goto(f"{BASE_URL}/explore/characters")
        page.wait_for_load_state("networkidle")

        search_input = page.locator(".search-box-input")
        page.wait_for_selector(".search-box-input", timeout=10000)

        search_input.fill(marker_rpg)
        page.wait_for_timeout(500)
        page.wait_for_load_state("networkidle")

        rpg_badge = page.locator(".mode-badge-gold")
        assert rpg_badge.count() >= 1, "RPG character should have gold badge"
        rpg_color = rpg_badge.first.evaluate("el => getComputedStyle(el).color")
        assert rpg_color == "rgb(227, 189, 108)", f"Expected gold rgb(227, 189, 108), got {rpg_color}"

        search_input.fill(marker_char)
        page.wait_for_timeout(500)
        page.wait_for_load_state("networkidle")

        char_badge = page.locator(".mode-badge-crimson")
        assert char_badge.count() >= 1, "Character mode character should have crimson badge"
        char_color = char_badge.first.evaluate("el => getComputedStyle(el).color")
        assert char_color == "rgb(226, 73, 61)", f"Expected crimson rgb(226, 73, 61), got {char_color}"

        page.close()
    finally:
        client.delete(f"/api/characters/{rpg_char_id}")
        client.delete(f"/api/characters/{char_char_id}")
        client.close()
