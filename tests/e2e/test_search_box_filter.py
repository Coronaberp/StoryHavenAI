import os
from playwright.sync_api import expect

SEARCH_BOX_JS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "new_ui", "js", "search-box.js"
))
CARDS_CSS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "new_ui", "css", "cards.css"
))

_STUB_HTML = """
<!DOCTYPE html>
<html><body>
<div id="box"></div>
<script>
  function _esc(s) { return String(s == null ? "" : s); }
  function _attr(s) { return String(s == null ? "" : s); }
  function t(key, fallback) { return fallback !== undefined ? fallback : key; }
  function toast() {}
  window.__apiCalls = 0;
  window.__apiDelayMs = 1200;
  function api(url) {
    window.__apiCalls++;
    return new Promise((resolve) => {
      setTimeout(() => resolve([]), window.__apiDelayMs);
    });
  }
</script>
</body></html>
"""


def _load_page(page):
    page.set_content(_STUB_HTML)
    page.add_style_tag(path=CARDS_CSS_PATH)
    page.add_script_tag(path=SEARCH_BOX_JS_PATH)


def test_filter_button_renders_reflects_state_and_fires_onclick(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__filterClicked = false;
        window.__searchBox = new SearchBox({
            container: document.getElementById("box"),
            mode: "client",
            placeholder: "",
            onChange: () => {},
            filter: {
                count: () => 3,
                active: () => true,
                onClick: () => { window.__filterClicked = true; },
            },
        });
    }""")

    filter_btn = page.locator("#box .search-box-filter-btn")
    expect(filter_btn).to_be_visible()
    expect(page.locator("#box .search-box-filter-btn.on")).to_be_visible()
    expect(page.locator("#box .search-box-filter-count")).to_have_text("3")

    filter_btn.click()
    assert page.evaluate("() => window.__filterClicked") is True
    page.close()


def test_filter_button_hidden_when_count_zero_and_not_active(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__searchBox = new SearchBox({
            container: document.getElementById("box"),
            mode: "client",
            placeholder: "",
            onChange: () => {},
            filter: { count: () => 0, active: () => false, onClick: () => {} },
        });
    }""")
    expect(page.locator("#box .search-box-filter-btn")).to_be_visible()
    expect(page.locator("#box .search-box-filter-btn.on")).to_have_count(0)
    expect(page.locator("#box .search-box-filter-count")).to_have_count(0)
    page.close()


def test_no_filter_option_renders_no_filter_button(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__searchBox = new SearchBox({
            container: document.getElementById("box"),
            mode: "client",
            placeholder: "",
            onChange: () => {},
        });
    }""")
    expect(page.locator("#box .search-box-filter-btn")).to_have_count(0)
    page.close()


def test_spinner_shows_during_fetch_and_hides_after(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__searchBox = new SearchBox({
            container: document.getElementById("box"),
            mode: "server",
            endpoint: "/api/fake",
            placeholder: "",
            onChange: () => {},
        });
    }""")
    input_box = page.locator("#box .search-box-input")
    input_box.fill("zz-search-spinner-probe")
    expect(page.locator("#box .search-box-spinner")).to_be_visible()
    expect(page.locator("#box .search-box-spinner")).to_be_hidden(timeout=5000)
    assert page.evaluate("() => window.__apiCalls") >= 1
    page.close()


def test_refresh_filter_re_renders_without_touching_query_state(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__active = false;
        window.__searchBox = new SearchBox({
            container: document.getElementById("box"),
            mode: "client",
            placeholder: "",
            onChange: () => {},
            filter: { count: () => 0, active: () => window.__active, onClick: () => {} },
        });
        window.__searchBox.setState({ query: "hello" });
    }""")
    expect(page.locator("#box .search-box-filter-btn.on")).to_have_count(0)
    page.evaluate("""() => {
        window.__active = true;
        window.__searchBox.refreshFilter();
    }""")
    expect(page.locator("#box .search-box-filter-btn.on")).to_be_visible()
    expect(page.locator("#box .search-box-input")).to_have_value("hello")
    page.close()


def test_omitting_filter_matches_previous_markup_shape(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__searchBox = new SearchBox({
            container: document.getElementById("box"),
            mode: "client",
            placeholder: "search",
            onChange: () => {},
        });
    }""")
    expect(page.locator("#box .search-box")).to_be_visible()
    expect(page.locator("#box .search-box-input")).to_be_visible()
    expect(page.locator("#box .search-box-filter-btn")).to_have_count(0)
    expect(page.locator("#box .search-box-spinner")).to_have_count(0)
    page.close()
