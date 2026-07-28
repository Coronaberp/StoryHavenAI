import os
from playwright.sync_api import expect

EXPLORE_CHARACTERS_JS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "new_ui", "js", "explore-characters.js"
))
CARDS_CSS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "new_ui", "css", "cards.css"
))

_STUB_HTML = """
<!DOCTYPE html>
<html><body>
<div id="root"></div>
<script>
  function _esc(s) { return String(s == null ? "" : s); }
  function _attr(s) { return String(s == null ? "" : s); }
  function t(key, fallback) { return fallback !== undefined ? fallback : key; }
  window.__navigateCalls = [];
  function navigate(route) { window.__navigateCalls.push(route); }
</script>
</body></html>
"""


def _load_page(page):
    page.set_content(_STUB_HTML)
    page.add_style_tag(path=CARDS_CSS_PATH)
    page.add_script_tag(path=EXPLORE_CHARACTERS_JS_PATH)


def test_characters_tab_bar_renders_with_characters_active(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        document.getElementById("root").innerHTML = exploreTabsHtml("characters");
    }""")

    expect(page.locator(".explore-tabs")).to_be_visible()
    expect(page.locator(".explore-tab")).to_have_count(4)
    active = page.locator(".explore-tab.active")
    expect(active).to_have_count(1)
    expect(active).to_have_text("Characters")
    expect(page.locator(".explore-tab[data-tab-key='characters']")).to_have_class("explore-tab active")
    page.close()


def test_clicking_a_tab_calls_navigate_with_the_right_route(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        document.getElementById("root").innerHTML = exploreTabsHtml("characters");
    }""")

    page.click(".explore-tab[data-tab-key='forum']")
    page.click(".explore-tab[data-tab-key='media']")
    page.click(".explore-tab[data-tab-key='creators']")
    page.click(".explore-tab[data-tab-key='characters']")

    calls = page.evaluate("() => window.__navigateCalls")
    assert calls == [
        "/explore/forum",
        "/explore/media",
        "/explore/creators",
        "/explore/characters",
    ]
    page.close()
