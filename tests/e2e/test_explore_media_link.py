from conftest import BASE_URL
from playwright.sync_api import expect


def test_explore_media_link_has_correct_href(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore")
    page.wait_for_load_state("networkidle")

    media_see_all_link = page.locator('a[href="/explore/media"]')
    expect(media_see_all_link).to_have_count(1)
    assert page.locator('a[href="/explore/images"]').count() == 0
    page.close()


def test_explore_media_page_is_navigable(browser):
    page = browser.new_page()
    page.goto(f"{BASE_URL}/explore")
    page.wait_for_load_state("networkidle")

    page.click(".explore-tab:has-text('Media')")
    page.wait_for_url(f"{BASE_URL}/explore/media")
    page.wait_for_load_state("networkidle")

    page.close()
