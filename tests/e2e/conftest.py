import pytest
from playwright.sync_api import sync_playwright

BASE_URL = "https://test.storyhaven.dev"


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def login(page, username, password):
    page.goto(f"{BASE_URL}/login")
    page.wait_for_selector('input[data-field="username"]:visible')
    page.wait_for_load_state("networkidle")
    page.fill('input[data-field="username"]:visible', username)
    page.fill('input[data-field="password"]:visible', password)
    page.evaluate("""() => {
        const btns = document.querySelectorAll('button[data-auth-submit="signin"]');
        btns[btns.length - 1].click();
    }""")
    page.wait_for_function("() => !location.pathname.includes('/login')", timeout=10000)
