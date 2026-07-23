from backend.prompt import reply_matches_language_script


def test_chinese_target_rejects_english_reply():
    text = "This is a fairly long English reply that should not pass as Chinese at all."
    assert reply_matches_language_script(text, "Chinese") is False


def test_chinese_target_accepts_chinese_reply():
    text = "这是一个相当长的中文回复，应该通过脚本检测测试而不会出现任何问题。"
    assert reply_matches_language_script(text, "Chinese") is True


def test_russian_target_rejects_english_reply():
    text = "This is a fairly long English reply that should not pass as Russian at all."
    assert reply_matches_language_script(text, "Russian") is False


def test_russian_target_accepts_cyrillic_reply():
    text = "Это довольно длинный русский ответ, который должен пройти проверку скрипта без проблем."
    assert reply_matches_language_script(text, "Russian") is True


def test_latin_script_target_always_trusted():
    assert reply_matches_language_script("This is plain English text of decent length here.", "French") is True


def test_short_reply_always_trusted():
    assert reply_matches_language_script("Hello there", "Russian") is True


def test_unknown_language_always_trusted():
    text = "This is a fairly long English reply for an unmapped target language entry."
    assert reply_matches_language_script(text, "Klingon") is True
