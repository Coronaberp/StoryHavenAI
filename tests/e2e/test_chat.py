import uuid
from conftest import BASE_URL, login, api_login, api_client, E2E_MARKER


def test_send_message_and_receive_reply(browser):
    marker = f"{E2E_MARKER}{uuid.uuid4().hex[:8]}]"
    cookie = api_login("test", "11111111")
    client = api_client(cookie)

    char_resp = client.post("/api/characters", json={
        "name": f"E2E Test Character {marker}",
        "mode": "rpg",
        "greeting": "Welcome, traveler.",
    })
    char_resp.raise_for_status()
    char_id = char_resp.json()["id"]

    session_resp = client.post(f"/api/characters/{char_id}/sessions", json={
        "persona_id": None, "greeting_index": 0,
    })
    session_resp.raise_for_status()
    session_id = session_resp.json()["id"]

    try:
        page = browser.new_page()
        login(page, "test", "11111111")
        page.goto(f"{BASE_URL}/chats/{session_id}")
        page.wait_for_selector("#chatInput", timeout=10000)
        page.fill("#chatInput", "Hello, who are you?")
        page.click("#chatSend")
        writing_selector = ".chat-writing:not(#chatTypingIndicator)"
        page.wait_for_selector(writing_selector, timeout=5000)
        page.wait_for_selector(writing_selector, state="detached", timeout=60000)
        page.reload()
        page.wait_for_selector("#chatInput", timeout=10000)
        thread_text = page.inner_text(".chat-thread-inner")
        assert "Hello, who are you?" in thread_text
        page.close()
    finally:
        client.delete(f"/api/sessions/{session_id}")
        client.delete(f"/api/characters/{char_id}")
        client.close()
