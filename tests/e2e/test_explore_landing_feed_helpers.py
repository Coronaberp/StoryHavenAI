import os
from playwright.sync_api import expect

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CHAR_JS = os.path.join(ROOT, "new_ui", "js", "explore-characters.js")
FORUM_JS = os.path.join(ROOT, "new_ui", "js", "explore-forum.js")
CARDS_CSS = os.path.join(ROOT, "new_ui", "css", "cards.css")

_STUB_HTML = """
<!DOCTYPE html>
<html><body>
<div id="root"></div>
<script>
  function _esc(s) { return String(s == null ? "" : s); }
  function _attr(s) { return String(s == null ? "" : s); }
  function t(key, fallback) { return fallback !== undefined ? fallback : key; }
  function navigate(route) { window.__navigateCalls = (window.__navigateCalls || []); window.__navigateCalls.push(route); }
  function timeAgo() { return "2h ago"; }
  function groupGridAvatar() { return "<div></div>"; }
</script>
</body></html>
"""


def test_group_tile_html_is_a_global_function(browser):
    page = browser.new_page()
    page.set_content(_STUB_HTML)
    page.add_style_tag(path=CARDS_CSS)
    page.add_script_tag(path=CHAR_JS)
    html = page.evaluate("""() => groupTileHtml({
        id: "g1", name: "Vaeroth Chronicles", group_mode: "roleplay", cast_preview: []
    })""")
    assert "Vaeroth Chronicles" in html
    assert "mode-badge-gold" in html


def test_thread_card_html_is_a_global_function(browser):
    page = browser.new_page()
    page.set_content(_STUB_HTML)
    page.add_style_tag(path=CARDS_CSS)
    page.add_script_tag(path=FORUM_JS)
    html = page.evaluate("""() => threadCardHtml({
        id: "t1", title: "Best dragon builds?", content: "Looking for RPG setups",
        author_username: "acrimony", created: 0, reply_count: 3, score: 1
    })""")
    assert "Best dragon builds?" in html
    assert "thread-card" in html
