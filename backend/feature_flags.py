from fastapi import Depends, HTTPException

from backend.auth import get_current_user
from backend.repositories import feature_flags as feature_flags_repo

FEATURE_KEYS = {
    "chat": "Chat & Roleplay",
    "lora_training": "LoRA Training",
    "comments": "Comments",
    "forum": "Forum",
    "characters": "Character Creation",
    "personas": "Persona Creation",
    "lore": "Lore Entries",
    "groups": "Group Templates",
    "emojis": "Custom Emojis & Stickers",
    "group_chats": "Group Chat Sessions",
    "profile": "Profile Customization",
    "follows": "Following Creators",
}

FEATURE_IMPACT_DESCRIPTIONS = {
    "chat": "Users will be unable to send new messages in any chat, existing or new",
    "lora_training": "Users will be unable to start new LoRA training jobs",
    "comments": "Users will be unable to post new comments anywhere on the site",
    "forum": "Users will be unable to create new forum threads or replies",
    "characters": "Users will be unable to create new characters",
    "personas": "Users will be unable to create new personas",
    "lore": "Users will be unable to add new lore entries to a character",
    "groups": "Users will be unable to publish new group templates",
    "emojis": "Users will be unable to upload new custom emojis or stickers",
    "group_chats": "Users will be unable to start new group chat sessions",
    "profile": "Users will be unable to upload a new avatar, banner, or chat background",
    "follows": "Users will be unable to follow other users or creators",
}

def require_feature_enabled(key: str):
    async def _check(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") == "dev":
            return
        flag = await feature_flags_repo.get(key)
        if flag and not flag["enabled"]:
            raise HTTPException(status_code=503, detail={
                "feature": key,
                "label": FEATURE_KEYS.get(key, key),
                "message": flag["message"],
                "eta_minutes": flag["eta_minutes"],
                "disabled_at": flag["disabled_at"],
                "updated_by_name": flag["updated_by_name"],
                "updated_by_role": flag["updated_by_role"],
            })
    return _check
