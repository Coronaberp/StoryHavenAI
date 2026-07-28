from conftest import BASE_URL
from playwright.sync_api import expect


def test_explore_tabs_render_with_characters_tab_active(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/characters")
    page.wait_for_load_state("networkidle")

    expect(page.locator(".explore-tab")).to_have_count(4)
    active_tabs = page.locator(".explore-tab.active")
    expect(active_tabs).to_have_count(1)
    expect(active_tabs).to_have_text("Characters")
    page.close()


def test_click_forum_tab_navigates_to_explore_forum(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/characters")
    page.wait_for_load_state("networkidle")

    page.click(".explore-tab:has-text('Forum')")
    page.wait_for_url(f"{BASE_URL}/explore/forum")
    page.wait_for_load_state("networkidle")

    expect(page.locator(".explore-tab.active")).to_have_text("Forum")
    page.close()


def test_click_media_tab_navigates_to_explore_media(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/characters")
    page.wait_for_load_state("networkidle")

    page.click(".explore-tab:has-text('Media')")
    page.wait_for_url(f"{BASE_URL}/explore/media")
    page.wait_for_load_state("networkidle")

    expect(page.locator(".explore-tab.active")).to_have_text("Media")
    page.close()


def test_click_creators_tab_navigates_to_explore_creators(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/characters")
    page.wait_for_load_state("networkidle")

    page.click(".explore-tab:has-text('Creators')")
    page.wait_for_url(f"{BASE_URL}/explore/creators")
    page.wait_for_load_state("networkidle")

    expect(page.locator(".explore-tab.active")).to_have_text("Creators")
    page.close()


def test_click_characters_tab_navigates_to_explore_characters(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/media")
    page.wait_for_load_state("networkidle")

    page.click(".explore-tab:has-text('Characters')")
    page.wait_for_url(f"{BASE_URL}/explore/characters")
    page.wait_for_load_state("networkidle")

    expect(page.locator(".explore-tab.active")).to_have_text("Characters")
    page.close()
