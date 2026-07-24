PROVIDER_REGISTRY = {
    "google": {
        "label": "Google",
        "protocol": "oauth2",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid profile",
        "user_id_field": "sub",
        "display_name_field": "name",
        "pkce": True,
    },
    "facebook": {
        "label": "Facebook",
        "protocol": "oauth2",
        "authorize_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "userinfo_url": "https://graph.facebook.com/me?fields=id,name",
        "scope": "public_profile",
        "user_id_field": "id",
        "display_name_field": "name",
        "pkce": False,
    },
    "github": {
        "label": "GitHub",
        "protocol": "oauth2",
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "userinfo_url": "https://api.github.com/user",
        "scope": "read:user",
        "user_id_field": "id",
        "display_name_field": "login",
        "pkce": False,
    },
    "discord": {
        "label": "Discord",
        "protocol": "oauth2",
        "authorize_url": "https://discord.com/api/oauth2/authorize",
        "token_url": "https://discord.com/api/oauth2/token",
        "userinfo_url": "https://discord.com/api/users/@me",
        "scope": "identify",
        "user_id_field": "id",
        "display_name_field": "username",
        "pkce": False,
    },
    "twitter": {
        "label": "Twitter / X",
        "protocol": "oauth2",
        "authorize_url": "https://twitter.com/i/oauth2/authorize",
        "token_url": "https://api.twitter.com/2/oauth2/token",
        "userinfo_url": "https://api.twitter.com/2/users/me",
        "scope": "tweet.read users.read",
        "user_id_field": "data.id",
        "display_name_field": "data.username",
        "pkce": True,
    },
    "reddit": {
        "label": "Reddit",
        "protocol": "oauth2",
        "authorize_url": "https://www.reddit.com/api/v1/authorize",
        "token_url": "https://www.reddit.com/api/v1/access_token",
        "userinfo_url": "https://oauth.reddit.com/api/v1/me",
        "scope": "identity",
        "user_id_field": "id",
        "display_name_field": "name",
        "pkce": False,
        "token_basic_auth": True,
    },
    "microsoft": {
        "label": "Microsoft",
        "protocol": "oauth2",
        "authorize_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo_url": "https://graph.microsoft.com/oidc/userinfo",
        "scope": "openid profile",
        "user_id_field": "sub",
        "display_name_field": "name",
        "pkce": True,
    },
    "steam": {
        "label": "Steam",
        "protocol": "openid2",
        "authorize_url": "https://steamcommunity.com/openid/login",
        "scope": "",
        "user_id_field": "steamid",
        "display_name_field": None,
        "pkce": False,
    },
    "apple": {
        "label": "Apple",
        "protocol": "oauth2_apple",
        "authorize_url": "https://appleid.apple.com/auth/authorize",
        "token_url": "https://appleid.apple.com/auth/token",
        "userinfo_url": None,
        "scope": "name",
        "user_id_field": "sub",
        "display_name_field": None,
        "pkce": False,
    },
}

def extract_user_id(provider: str, payload: dict) -> str | None:
    entry = PROVIDER_REGISTRY.get(provider)
    if not entry:
        return None
    field = entry["user_id_field"]
    value = payload
    for part in field.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return str(value) if value is not None else None
