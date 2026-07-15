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


def test_unauthenticated_user_redirected_to_login_on_protected_route(static_server, browser):
    page = _new_page(browser)
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=401, content_type="application/json", body='{"detail":"Not authenticated"}'))
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/library')")
    page.wait_for_timeout(300)
    assert page.url.endswith("/login")
    page.close()


def test_unauthenticated_user_not_redirected_on_public_routes(static_server, browser):
    page = _new_page(browser)
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=401, content_type="application/json", body='{"detail":"Not authenticated"}'))
    page.route("**/api/auth/totp/provision", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body='{"secret":"JBSWY3DPEHPK3PXP","otpauth_uri":"otpauth://totp/x:y?secret=JBSWY3DPEHPK3PXP"}'))
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    for public_route in ["/register", "/wait", "/login"]:
        page.evaluate(f"navigate('{public_route}')")
        page.wait_for_timeout(200)
        assert page.url.endswith(public_route), f"expected to stay on {public_route}, got {page.url}"
    page.evaluate("window.OnboardFlow.username = 'kael'; window.OnboardFlow.password = 'pw';")
    page.evaluate("navigate('/onboard')")
    page.wait_for_timeout(300)
    assert page.url.endswith("/onboard"), f"expected to stay on /onboard, got {page.url}"
    page.close()


def test_authenticated_user_not_redirected_on_protected_route(static_server, browser):
    page = _new_page(browser)
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=200, content_type="application/json", body='{"id":"u1","username":"kael"}'))
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/library')")
    page.wait_for_timeout(300)
    assert page.url.endswith("/library")
    page.close()


def test_authenticated_user_redirected_away_from_login(static_server, browser):
    page = _new_page(browser)
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=200, content_type="application/json", body='{"id":"u1","username":"kael"}'))
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/login')")
    page.wait_for_timeout(300)
    assert not page.url.endswith("/login"), f"expected to be redirected away from /login, got {page.url}"
    page.close()


def test_hero_chrome_persists_same_dom_node_across_navigation(static_server, browser):
    page = _new_page(browser)
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=401, content_type="application/json", body='{"detail":"Not authenticated"}'))
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/login')")
    page.wait_for_timeout(300)

    page.evaluate("document.querySelector('#heroChrome .login-float').dataset.marker = 'test-marker'")

    page.click('[data-auth-link="forgot"]')
    page.wait_for_timeout(300)
    assert page.evaluate("document.querySelector('#heroChrome .login-float')?.dataset.marker") == "test-marker"

    page.evaluate("navigate('/login')")
    page.wait_for_timeout(200)
    page.click('[data-register-link]')
    page.wait_for_timeout(300)
    assert page.evaluate("document.querySelector('#heroChrome .login-float')?.dataset.marker") == "test-marker"
    page.close()


def test_hero_chrome_hidden_on_compact_scene_route(static_server, browser):
    page = _new_page(browser)
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=401, content_type="application/json", body='{"detail":"Not authenticated"}'))
    page.route("**/api/auth/totp/provision", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body='{"secret":"JBSWY3DPEHPK3PXP","otpauth_uri":"otpauth://totp/x:y?secret=JBSWY3DPEHPK3PXP"}'))
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("window.OnboardFlow.username = 'kael'; window.OnboardFlow.password = 'pw';")
    page.evaluate("navigate('/onboard')")
    page.wait_for_timeout(400)
    assert page.evaluate("document.getElementById('heroChrome').classList.contains('hidden')") is True
    page.close()
