import pytest

pytestmark = pytest.mark.asyncio


async def test_author_can_delete_own_comment_without_any_capability(db_conn):
    from backend.repositories import comments as comment_repo
    from backend.repositories import users as user_repo
    from backend.routers.comments import delete_comment
    await user_repo.create_user("author1", "password123")
    author = await user_repo.get_user_by_username("author1")
    cid = await comment_repo.create(target_type="character", target_id="char1",
                                     author_id=author["id"], parent_id=None, content="hi")
    result = await delete_comment(cid, current_user={"id": author["id"], "role": "member", "is_admin": False, "username": "author1"})
    assert result == {"deleted": True}


async def test_non_author_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.repositories import comments as comment_repo
    from backend.repositories import users as user_repo
    from backend.routers.comments import delete_comment
    await user_repo.create_user("author2", "password123")
    await user_repo.create_user("other1", "password123")
    author = await user_repo.get_user_by_username("author2")
    other = await user_repo.get_user_by_username("other1")
    cid = await comment_repo.create(target_type="character", target_id="char2",
                                     author_id=author["id"], parent_id=None, content="hi")
    with pytest.raises(HTTPException) as exc_info:
        await delete_comment(cid, current_user={"id": other["id"], "role": "member", "is_admin": False, "username": "other1"})
    assert exc_info.value.status_code == 403


async def test_non_author_allowed_with_capability(db_conn):
    from backend.repositories import comments as comment_repo
    from backend.repositories import users as user_repo
    from backend.repositories import role_capabilities as rc
    from backend.routers.comments import delete_comment
    await user_repo.create_user("author3", "password123")
    await user_repo.create_user("moderator1", "password123")
    author = await user_repo.get_user_by_username("author3")
    moderator = await user_repo.get_user_by_username("moderator1")
    await rc.grant("member", "comments.delete_any")
    cid = await comment_repo.create(target_type="character", target_id="char3",
                                     author_id=author["id"], parent_id=None, content="hi")
    result = await delete_comment(cid, current_user={"id": moderator["id"], "role": "member", "is_admin": False, "username": "moderator1"})
    assert result == {"deleted": True}
