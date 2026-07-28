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


def test_rpg_character_card_gets_gold_mode_badge(browser):
    page = browser.new_page()
    _load_page(page)
    html = page.evaluate("""() => {
        return characterCardHtml({ id: "c1", name: "Roleplay Char", mode: "rpg", tags: [], chats: 0 }, null, {});
    }""")
    page.set_content(f"<div id='main'>{html}</div>")
    badge = page.locator(".mode-badge-gold")
    expect(badge).to_have_count(1)
    expect(page.locator(".mode-badge-crimson")).to_have_count(0)
    page.close()


def test_character_mode_card_gets_crimson_mode_badge(browser):
    page = browser.new_page()
    _load_page(page)
    html = page.evaluate("""() => {
        return characterCardHtml({ id: "c2", name: "Chat Char", mode: "character", tags: [], chats: 0 }, null, {});
    }""")
    page.set_content(f"<div id='main'>{html}</div>")
    expect(page.locator(".mode-badge-crimson")).to_have_count(1)
    expect(page.locator(".mode-badge-gold")).to_have_count(0)
    page.close()


def test_roleplay_group_card_gets_gold_mode_badge(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__view = new ExploreCharactersView({ scope: "community" });
    }""")
    html = page.evaluate("""() => {
        return groupTileHtml({ id: "g1", name: "RP Group", group_mode: "roleplay", cast_preview: [] });
    }""")
    page.set_content(f"<div id='main'>{html}</div>")
    expect(page.locator(".mode-badge-gold")).to_have_count(1)
    page.close()


def test_chat_group_card_gets_crimson_mode_badge(browser):
    page = browser.new_page()
    _load_page(page)
    page.evaluate("""() => {
        window.__view = new ExploreCharactersView({ scope: "community" });
    }""")
    html = page.evaluate("""() => {
        return groupTileHtml({ id: "g2", name: "Chat Group", group_mode: "chat", cast_preview: [] });
    }""")
    page.set_content(f"<div id='main'>{html}</div>")
    expect(page.locator(".mode-badge-crimson")).to_have_count(1)
    page.close()


def test_mode_badge_colors_are_literal_hex_not_theme_variable(browser):
    page = browser.new_page()
    _load_page(page)
    gold_html = page.evaluate("""() => {
        return characterCardHtml({ id: "c1", name: "Roleplay Char", mode: "rpg", tags: [], chats: 0 }, null, {});
    }""")
    crimson_html = page.evaluate("""() => {
        return characterCardHtml({ id: "c2", name: "Chat Char", mode: "character", tags: [], chats: 0 }, null, {});
    }""")
    page.set_content(f"<div id='gold'>{gold_html}</div><div id='crimson'>{crimson_html}</div>")
    page.add_style_tag(path=CARDS_CSS_PATH)
    gold_color = page.locator("#gold .mode-badge-gold").evaluate("el => getComputedStyle(el).color")
    crimson_color = page.locator("#crimson .mode-badge-crimson").evaluate("el => getComputedStyle(el).color")
    assert gold_color == "rgb(227, 189, 108)"
    assert crimson_color == "rgb(226, 73, 61)"
    assert "var(--color-accent)" not in gold_html
    assert "var(--color-accent)" not in crimson_html
    page.close()
