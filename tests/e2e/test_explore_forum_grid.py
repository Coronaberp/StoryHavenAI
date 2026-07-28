import os
from playwright.sync_api import expect

JS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "new_ui", "js"))
SEARCH_BOX_JS_PATH = os.path.join(JS_DIR, "search-box.js")
EXPLORE_CHARACTERS_JS_PATH = os.path.join(JS_DIR, "explore-characters.js")
EXPLORE_FORUM_JS_PATH = os.path.join(JS_DIR, "explore-forum.js")
CARDS_CSS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "new_ui", "css", "cards.css"
))

_STUB_HTML = """
<!DOCTYPE html>
<html><body>
<div id="main"></div>
<script>
  function _esc(s) { return String(s == null ? "" : s); }
  function _attr(s) { return String(s == null ? "" : s); }
  function t(key, fallback) { return fallback !== undefined ? fallback : key; }
  function toast() {}
  function pageHeaderHtml() { return ""; }
  function dirMark(a, b) { return a; }
  function navigate(path) { window.__navigatedTo = path; }
  function onPaginate() {}
  function paginatePage() { return 1; }
  function resetPagination() {}
  function paginationHtml() { return ""; }
  function openModal() {}
  function closeTopModal() {}
  function closeModal() {}
  window.ME = null;
  window.__threads = [
    { id: "t1", title: "First Thread", content: "Some body text here", category: "General",
      author_username: "alice", created: Math.floor(Date.now() / 1000) - 60, reply_count: 2, score: 1, my_vote: 0 },
    { id: "t2", title: "Second Thread", content: "Another body text", category: "General",
      author_username: "bob", created: Math.floor(Date.now() / 1000) - 120, reply_count: 0, score: 0, my_vote: 0 },
  ];
  function api(url) {
    if (url.includes("paged=1")) {
      return Promise.resolve({ threads: window.__threads, total: window.__threads.length });
    }
    return Promise.resolve(window.__threads);
  }
</script>
</body></html>
"""


def _load_page(page):
    page.set_content(_STUB_HTML)
    page.add_style_tag(path=CARDS_CSS_PATH)
    page.add_script_tag(path=SEARCH_BOX_JS_PATH)
    page.add_script_tag(path=EXPLORE_CHARACTERS_JS_PATH)
    page.add_script_tag(path=EXPLORE_FORUM_JS_PATH)


def test_forum_threads_render_as_card_grid_and_are_clickable(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__view = new ExploreForumView();
        window.__view.mount(document.getElementById("main"));
    }""")

    grid = page.locator("#forumResultsArea .card-grid")
    expect(grid).to_be_visible()
    first_card = grid.locator(".thread-card").first
    expect(first_card).to_be_visible()
    first_card.click()
    assert page.evaluate("window.__navigatedTo") == "/explore/forum/t1"
    page.close()


def test_forum_category_filter_is_behind_search_box_filter_button(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__view = new ExploreForumView();
        window.__view.mount(document.getElementById("main"));
    }""")

    filter_btn = page.locator("#forumSearchBox .search-box-filter-btn")
    expect(filter_btn).to_be_visible()
    filter_btn.click()
    expect(page.locator("#forumDrawer")).to_be_visible()
    page.close()


def test_forum_thread_card_does_not_render_inline_vote_buttons(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__view = new ExploreForumView();
        window.__view.mount(document.getElementById("main"));
    }""")

    expect(page.locator("#forumResultsArea [data-vote-up]")).to_have_count(0)
    expect(page.locator("#forumResultsArea [data-vote-down]")).to_have_count(0)
    page.close()
