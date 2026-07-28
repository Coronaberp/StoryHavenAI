from playwright.sync_api import expect
from conftest import BASE_URL


def test_explore_characters_filter_btn_visible_and_opens_drawer(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/characters")
    page.wait_for_load_state("networkidle")

    filter_btn = page.locator(".search-box-filter-btn")
    expect(filter_btn).to_be_visible()

    filter_btn.click()
    drawer = page.locator("#compendiumDrawer")
    expect(drawer).to_be_visible()

    page.close()


def test_search_box_spinner_appears_during_fetch(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/characters")
    page.wait_for_load_state("networkidle")

    search_input = page.locator(".search-box-input")
    search_input.click()

    page.wait_for_timeout(200)
    page.type(".search-box-input", "nosuchcharacterlorem999", delay=250)

    spinner = page.locator(".search-box-spinner")
    expect(spinner).to_be_visible(timeout=10000)
    expect(spinner).to_be_hidden(timeout=20000)

    page.close()


def test_explore_media_has_no_filter_btn(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore/media")
    page.wait_for_load_state("networkidle")

    filter_btn = page.locator(".search-box-filter-btn")
    expect(filter_btn).to_have_count(0)

    page.close()
