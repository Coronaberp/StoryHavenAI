import os
from playwright.sync_api import expect

JS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "new_ui", "js"))
EXPLORE_JS_PATH = os.path.join(JS_DIR, "explore.js")

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
  function navigate() {}
  function characterCardHtml() { return ""; }
  window.ME = null;
  function api(url) { return Promise.resolve([]); }
</script>
</body></html>
"""


def _load_page(page):
    page.set_content(_STUB_HTML)
    page.add_script_tag(path=EXPLORE_JS_PATH)


def test_media_gallery_section_see_all_link_points_to_explore_media(browser):
    page = browser.new_page()
    _load_page(page)
    html = page.evaluate("""() => {
        return ExploreView.prototype.sectionHtml.call({}, "Media Gallery", "explore/media", "", true, "Featured");
    }""")
    page.set_content(f"<div id='main'>{html}</div>")
    link = page.locator('a[href="/explore/media"]')
    expect(link).to_have_count(1)
    expect(page.locator('a[href="/explore/images"]')).to_have_count(0)
    page.close()


def test_landing_page_render_media_section_uses_explore_media_route():
    with open(EXPLORE_JS_PATH) as f:
        source = f.read()
    media_section_line = next(
        line for line in source.splitlines()
        if "compendium_section_media_gallery" in line
    )
    assert '"explore/media"' in media_section_line
    assert '"explore/images"' not in media_section_line
