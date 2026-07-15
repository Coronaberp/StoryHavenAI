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


def test_explore_is_default_route(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    assert page.evaluate("currentRoute()") == "explore"
    page.close()


def test_all_four_tab_routes_render_their_placeholder(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    for route_name, label in [
        ("explore", "Explore"), ("chats", "Chats"),
        ("studio", "Studio"), ("account", "Account"),
    ]:
        page.evaluate(f"navigate('/{route_name}')")
        page.wait_for_timeout(200)
        assert page.locator("#main h1").inner_text() == label
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
    for route_name in ["explore", "chats", "studio", "account"]:
        page.evaluate(f"navigate('/{route_name}')")
        page.wait_for_timeout(200)
        geo = page.evaluate(f"""() => {{
            const nav = document.getElementById('bottomNav');
            const ribbon = document.getElementById('navRibbon');
            const target = nav.querySelector('[data-route="{route_name}"]');
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
