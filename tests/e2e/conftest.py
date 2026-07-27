import re
import uuid
import pytest
import httpx
from playwright.sync_api import sync_playwright

BASE_URL = "https://test.storyhaven.dev"
E2E_MARKER = "[e2e-"


def api_login(username, password):
    r = httpx.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=30.0)
    r.raise_for_status()
    return r.cookies["sh_access"]


def api_client(cookie):
    return httpx.Client(base_url=BASE_URL, cookies={"sh_access": cookie}, timeout=30.0)


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


@pytest.fixture(scope="session", autouse=True)
def e2e_sweep():
    yield
    cookie = api_login("test", "11111111")
    client = api_client(cookie)
    try:
        sessions = client.get("/api/sessions").json()
        for s in sessions:
            if E2E_MARKER in (s.get("title") or ""):
                client.delete(f"/api/sessions/{s['id']}")
        characters = client.get("/api/characters").json()
        rows = characters if isinstance(characters, list) else characters.get("characters", [])
        for c in rows:
            if E2E_MARKER in (c.get("name") or ""):
                client.delete(f"/api/characters/{c['id']}")
    finally:
        client.close()
