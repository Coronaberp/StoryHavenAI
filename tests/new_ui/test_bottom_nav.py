import http.server
import socket
import threading
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

NEW_UI_DIR = Path(__file__).resolve().parents[2] / "new_ui"


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def static_server():
    port = _free_port()
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(NEW_UI_DIR), **kwargs)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    thread.join()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _new_page(browser):
    return browser.new_page(viewport={"width": 392, "height": 848})


def _mock_authenticated(page, accent_color="", banner_color="", avatar=""):
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body=(
            '{"id":"u1","username":"test","status":"active",'
            f'"accent_color":"{accent_color}","banner_color":"{banner_color}",'
            f'"avatar":"{avatar}"}}'
        )))


def test_avatar_ring_shows_image_when_avatar_set(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page, avatar="/media/u1.webp")
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    state = page.evaluate("""() => {
        const img = document.querySelector('[data-avatar-ring] img');
        const fallback = document.querySelector('[data-avatar-fallback]');
        return {
            imgHidden: img.classList.contains('hidden'),
            imgSrc: img.getAttribute('src'),
            fallbackHidden: fallback.classList.contains('hidden'),
        };
    }""")
    assert state["imgHidden"] is False
    assert state["imgSrc"] == "/media/u1.webp"
    assert state["fallbackHidden"] is True
    page.close()


def test_avatar_ring_shows_fallback_letter_when_no_avatar(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page, avatar="")
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    state = page.evaluate("""() => {
        const img = document.querySelector('[data-avatar-ring] img');
        const fallback = document.querySelector('[data-avatar-fallback]');
        return {
            imgHidden: img.classList.contains('hidden'),
            fallbackHidden: fallback.classList.contains('hidden'),
            fallbackText: fallback.textContent,
        };
    }""")
    assert state["imgHidden"] is True
    assert state["fallbackHidden"] is False
    assert state["fallbackText"] == "T"
    page.close()


def test_avatar_ring_uses_profile_accent_color_when_set(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page, accent_color="#ff0000", banner_color="#00ff00")
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    ring_var = page.evaluate(
        "document.querySelector('[data-avatar-ring]').style.getPropertyValue('--nav-avatar-ring')"
    )
    assert "255, 0, 0" in ring_var or "#ff0000" in ring_var.lower()
    assert "0, 255, 0" in ring_var or "#00ff00" in ring_var.lower()
    page.close()


def test_compendium_is_default_route(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    assert page.evaluate("currentRoute()") == "compendium"
    page.close()


def test_all_tab_routes_render_their_placeholder(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    for route_name, label in [
        ("compendium", "Compendium"), ("parlance", "Parlance"),
        ("sanctum", "Sanctum"), ("dossier", "My Dossier"),
        ("pantheon", "Pantheon"), ("pinacotheca", "Pinacotheca"), ("symposium", "Symposium"),
        ("forge", "My Forge"), ("grimoire", "My Grimoire"), ("masks", "My Masks"), ("casts", "My Casts"),
    ]:
        page.evaluate(f"navigate('/{route_name}')")
        page.wait_for_timeout(200)
        assert page.locator("#main h1").inner_text() == label
    page.close()


def test_compendium_and_sanctum_tabs_open_menus_instead_of_navigating(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.click('#bottomNav [data-route="compendium"]')
    page.wait_for_timeout(200)
    assert page.evaluate("currentRoute()") == "compendium"
    assert page.locator(".modal-layer .modal h3").inner_text() == "Compendium"
    page.click('.dropdown-item:has-text("Pantheon")')
    page.wait_for_timeout(200)
    assert page.evaluate("currentRoute()") == "pantheon"
    assert page.locator("#main h1").inner_text() == "Pantheon"

    page.click('#bottomNav [data-route="sanctum"]')
    page.wait_for_timeout(200)
    assert page.locator(".modal-layer .modal h3").inner_text() == "Sanctum"
    page.click('.dropdown-item:has-text("My Grimoire")')
    page.wait_for_timeout(200)
    assert page.evaluate("currentRoute()") == "grimoire"
    page.close()


def test_ribbon_shown_on_compendium_landing_page(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    assert page.evaluate("currentRoute()") == "compendium"
    assert page.evaluate("document.getElementById('navRibbon').classList.contains('hidden')") is False
    left = page.evaluate("document.getElementById('navRibbon').style.left")
    compendium_left = page.evaluate("""() => {
        const nav = document.getElementById('bottomNav');
        const target = nav.querySelector('[data-route="compendium"]');
        return (target.getBoundingClientRect().left - nav.getBoundingClientRect().left) + 'px';
    }""")
    assert left == compendium_left
    page.close()


def test_ribbon_hidden_on_sanctum_menu_only_route_shown_on_its_subroutes(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/sanctum')")
    page.wait_for_timeout(200)
    assert page.evaluate("document.getElementById('navRibbon').classList.contains('hidden')") is True
    page.evaluate("navigate('/grimoire')")
    page.wait_for_timeout(200)
    assert page.evaluate("document.getElementById('navRibbon').classList.contains('hidden')") is False
    left = page.evaluate("document.getElementById('navRibbon').style.left")
    sanctum_left = page.evaluate("""() => {
        const nav = document.getElementById('bottomNav');
        const target = nav.querySelector('[data-route="sanctum"]');
        return (target.getBoundingClientRect().left - nav.getBoundingClientRect().left) + 'px';
    }""")
    assert left == sanctum_left
    page.close()


def test_create_route_renders_placeholder_and_is_not_in_nav_routes(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/create')")
    page.wait_for_timeout(200)
    assert page.locator("#main h1").inner_text() == "New Character"
    assert page.evaluate("NAV_ROUTES.includes('create')") is False
    page.close()


def test_ribbon_hidden_on_create_route(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/create')")
    page.wait_for_timeout(200)
    ribbon_hidden = page.evaluate("document.getElementById('navRibbon').classList.contains('hidden')")
    assert ribbon_hidden is True
    page.close()


def test_ribbon_geometry_matches_active_tab_for_every_nav_route(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    for route_name, tab_route in [
        ("pantheon", "compendium"), ("parlance", "parlance"),
        ("forge", "sanctum"), ("dossier", "dossier"),
    ]:
        page.evaluate(f"navigate('/{route_name}')")
        page.wait_for_timeout(400)
        geo = page.evaluate(f"""() => {{
            const nav = document.getElementById('bottomNav');
            const ribbon = document.getElementById('navRibbon');
            const target = nav.querySelector('[data-route="{tab_route}"]');
            const navRect = nav.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const ribbonRect = ribbon.getBoundingClientRect();
            return {{
                expectedLeft: targetRect.left - navRect.left,
                actualLeft: ribbonRect.left - navRect.left,
                expectedWidth: targetRect.width,
                actualWidth: ribbonRect.width,
            }};
        }}""")
        assert abs(geo["expectedLeft"] - geo["actualLeft"]) < 1
        assert abs(geo["expectedWidth"] - geo["actualWidth"]) < 1
    page.close()
