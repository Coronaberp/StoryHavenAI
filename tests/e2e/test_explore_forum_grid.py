import uuid
from playwright.sync_api import expect
from conftest import BASE_URL, login, api_login, api_client, E2E_MARKER


def test_forum_threads_render_as_card_grid_and_are_clickable(browser):
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)

    thread_resp = client.post("/api/forum/threads", json={
        "title": f"E2E Test Thread {marker}",
        "content": "This is test content for the forum thread.",
        "category": "General",
    })
    thread_resp.raise_for_status()
    thread_data = thread_resp.json()
    thread_id = thread_data["id"]

    try:
        page = browser.new_page()
        login(page, "test", "11111111")
        page.goto(f"{BASE_URL}/explore/forum")
        page.wait_for_selector("#forumResultsArea .card-grid", timeout=10000)

        grid = page.locator("#forumResultsArea .card-grid")
        expect(grid).to_be_visible()

        thread_card = page.locator(f".thread-card[data-tid='{thread_id}']")
        expect(thread_card).to_be_visible()

        thread_card.click()
        page.wait_for_url(f"**/explore/forum/{thread_id}", timeout=10000)

        assert thread_id in page.url
        page.close()
    finally:
        client.delete(f"/api/forum/threads/{thread_id}")
        client.close()


def test_forum_category_filter_is_behind_search_box_filter_button(browser):
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)

    thread_resp = client.post("/api/forum/threads", json={
        "title": f"E2E Filter Test {marker}",
        "content": "Testing filter drawer visibility.",
        "category": "Questions",
    })
    thread_resp.raise_for_status()
    thread_id = thread_resp.json()["id"]

    try:
        page = browser.new_page()
        login(page, "test", "11111111")
        page.goto(f"{BASE_URL}/explore/forum")
        page.wait_for_selector("#forumSearchBox .search-box-filter-btn", timeout=10000)

        filter_btn = page.locator("#forumSearchBox .search-box-filter-btn")
        expect(filter_btn).to_be_visible()
        filter_btn.click()

        expect(page.locator("#forumDrawer")).to_be_visible(timeout=5000)
        page.close()
    finally:
        client.delete(f"/api/forum/threads/{thread_id}")
        client.close()
