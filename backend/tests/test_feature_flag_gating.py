from backend.state import api
from backend.routers import chat, lora_training, comments, forum, characters, personas, lore, groups
from backend.routers import emojis, sessions, profile

assert chat and lora_training and comments and forum and characters and personas and lore and groups
assert emojis and sessions and profile


def _dependency_keys(route):
    keys = []
    for dep in route.dependant.dependencies:
        if dep.call.__closure__:
            keys.extend(cell.cell_contents for cell in dep.call.__closure__)
    return keys


def test_chat_send_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/sessions/{sid}/chat" and "POST" in r.methods)
    assert "chat" in _dependency_keys(route)


def test_lora_training_job_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/admin/lora-training/jobs" and "POST" in r.methods)
    assert "lora_training" in _dependency_keys(route)


def test_comment_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/comments" and "POST" in r.methods)
    assert "comments" in _dependency_keys(route)


def test_forum_thread_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/forum/threads" and "POST" in r.methods)
    assert "forum" in _dependency_keys(route)


def test_character_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/characters" and "POST" in r.methods)
    assert "characters" in _dependency_keys(route)


def test_persona_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/personas" and "POST" in r.methods)
    assert "personas" in _dependency_keys(route)


def test_lore_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/characters/{cid}/lore" and "POST" in r.methods)
    assert "lore" in _dependency_keys(route)


def test_global_lore_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/lore/global" and "POST" in r.methods)
    assert "lore" in _dependency_keys(route)


def test_group_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/groups" and "POST" in r.methods)
    assert "groups" in _dependency_keys(route)


def test_emoji_upload_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/emojis" and "POST" in r.methods)
    assert "emojis" in _dependency_keys(route)


def test_group_chat_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/group-chats" and "POST" in r.methods)
    assert "group_chats" in _dependency_keys(route)


def test_new_chat_session_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/characters/{cid}/sessions" and "POST" in r.methods)
    assert "chat" in _dependency_keys(route)


def test_avatar_upload_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/me/avatar" and "POST" in r.methods)
    assert "profile" in _dependency_keys(route)


def test_banner_upload_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/me/banner" and "POST" in r.methods)
    assert "profile" in _dependency_keys(route)


def test_chat_background_upload_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/me/chat-background" and "POST" in r.methods)
    assert "profile" in _dependency_keys(route)


def test_follow_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/users/{username}/follow" and "POST" in r.methods)
    assert "follows" in _dependency_keys(route)
