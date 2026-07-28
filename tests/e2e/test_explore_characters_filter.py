import os
from playwright.sync_api import expect

JS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "new_ui", "js"))
SEARCH_BOX_JS_PATH = os.path.join(JS_DIR, "search-box.js")
EXPLORE_CHARACTERS_JS_PATH = os.path.join(JS_DIR, "explore-characters.js")
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
  function groupGridAvatar() { return ""; }
  function getBlockedTags() { return []; }
  window.ME = null;
  function api(url) { return Promise.resolve([]); }
</script>
</body></html>
"""


def _load_page(page):
    page.set_content(_STUB_HTML)
    page.add_style_tag(path=CARDS_CSS_PATH)
    page.add_script_tag(path=SEARCH_BOX_JS_PATH)
    page.add_script_tag(path=EXPLORE_CHARACTERS_JS_PATH)


def test_explore_characters_search_box_shows_filter_button_opens_drawer_and_reflects_count(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__view = new ExploreCharactersView({ scope: "community" });
        window.__view.filters.genres = ["Fantasy"];
        window.__view.mount(document.getElementById("main"));
    }""")

    filter_btn = page.locator("#compendiumSearchBox .search-box-filter-btn")
    expect(filter_btn).to_be_visible()
    expect(page.locator("#compendiumSearchBox .search-box-filter-count")).to_have_text("1")

    filter_btn.click()
    expect(page.locator("#compendiumDrawer")).to_be_visible()

    filter_btn.click()
    expect(page.locator("#compendiumDrawer")).to_have_count(0)
    page.close()
