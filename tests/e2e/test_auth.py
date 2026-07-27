from conftest import login


def test_login_succeeds_with_correct_credentials(browser):
    page = browser.new_page()
    login(page, "test", "11111111")
    assert page.url != f"{page.url.split('/login')[0]}/login"
    page.close()


def test_login_fails_with_wrong_password(browser):
    page = browser.new_page()
    page.goto("https://test.storyhaven.dev/login")
    page.wait_for_selector('input[data-field="username"]:visible')
    page.wait_for_load_state("networkidle")
    page.fill('input[data-field="username"]:visible', "test")
    page.fill('input[data-field="password"]:visible', "wrong-password-xyz")
    page.evaluate("""() => {
        const btns = document.querySelectorAll('button[data-auth-submit="signin"]');
        btns[btns.length - 1].click();
    }""")
    page.wait_for_timeout(1500)
    assert "/login" in page.url
    page.close()
