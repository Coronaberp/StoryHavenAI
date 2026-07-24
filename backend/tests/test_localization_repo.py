import pytest

from backend.repositories import localization as localization_repo

pytestmark = pytest.mark.asyncio

async def test_set_and_get_localizations(db_conn):
    assert await localization_repo.get([], "French") == {}
    assert await localization_repo.get(["nope"], "French") == {}

    await localization_repo.set([("hash-1", "Hello", "Bonjour"),
                                 ("hash-2", "World", "Monde")], "French")
    cached = await localization_repo.get(["hash-1", "hash-2", "hash-3"], "French")
    assert cached == {"hash-1": "Bonjour", "hash-2": "Monde"}

    other_lang = await localization_repo.get(["hash-1"], "German")
    assert other_lang == {}

async def test_set_localizations_overwrites_existing(db_conn):
    await localization_repo.set([("hash-x", "Cat", "Chat")], "French")
    assert await localization_repo.get(["hash-x"], "French") == {"hash-x": "Chat"}

    await localization_repo.set([("hash-x", "Cat", "Chat (updated)")], "French")
    assert await localization_repo.get(["hash-x"], "French") == {"hash-x": "Chat (updated)"}

async def test_get_localizations_chunks_over_500(db_conn):
    hashes = [f"hash-{i}" for i in range(600)]
    items = [(h, "src", f"tr-{h}") for h in hashes]
    await localization_repo.set(items, "Spanish")
    cached = await localization_repo.get(hashes, "Spanish")
    assert len(cached) == 600
    assert cached["hash-599"] == "tr-hash-599"
