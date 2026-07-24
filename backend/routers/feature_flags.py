from fastapi import Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_admin, get_current_user_optional
from backend.feature_flags import FEATURE_IMPACT_DESCRIPTIONS, FEATURE_KEYS
from backend.repositories import feature_flags as feature_flags_repo
from backend.repositories import notifications as notification_repo
from backend.repositories import users as user_repo
from backend.state import api, log

class FeatureFlagsBatchIn(BaseModel):
    keys: list[str]
    enabled: bool
    message: str | None = None
    eta_minutes: int | None = None

def _public_fields(key: str, row: dict) -> dict:
    return {
        "label": FEATURE_KEYS.get(key, key),
        "message": row.get("message"),
        "eta_minutes": row.get("eta_minutes"),
        "disabled_at": row.get("disabled_at"),
        "updated_by_name": row.get("updated_by_name"),
        "updated_by_role": row.get("updated_by_role"),
    }

async def _public_status(role: str | None) -> dict:
    if role == "dev":
        return {}
    all_flags = await feature_flags_repo.get_all()
    return {key: _public_fields(key, row) for key, row in all_flags.items()
            if not row["enabled"]}

@api.get("/admin/feature-flags")
async def admin_list_feature_flags(_: dict = Depends(get_admin)):
    all_flags = await feature_flags_repo.get_all()
    out = {}
    for key, label in FEATURE_KEYS.items():
        row = all_flags.get(key)
        out[key] = {
            "label": label,
            "impact": FEATURE_IMPACT_DESCRIPTIONS.get(key),
            "enabled": row["enabled"] if row else True,
            "message": row.get("message") if row else None,
            "eta_minutes": row.get("eta_minutes") if row else None,
            "disabled_at": row.get("disabled_at") if row else None,
            "updated_by_name": row.get("updated_by_name") if row else None,
            "updated_by_role": row.get("updated_by_role") if row else None,
        }
    return out

@api.put("/admin/feature-flags/batch")
async def admin_batch_feature_flags(body: FeatureFlagsBatchIn, current_user: dict = Depends(get_admin)):
    invalid = [k for k in body.keys if k not in FEATURE_KEYS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown feature keys: {', '.join(invalid)}")
    rows = await feature_flags_repo.apply_batch(
        keys=body.keys, enabled=body.enabled, message=body.message, eta_minutes=body.eta_minutes,
        updated_by=current_user["id"], updated_by_name=current_user["username"],
        updated_by_role=current_user.get("role", "admin"))
    role_label = "Dev" if current_user.get("role") == "dev" else "Admin"
    labels = ", ".join(FEATURE_KEYS[k] for k in body.keys)
    if body.enabled:
        title = f"{labels} restored"
        notif_body = f"{role_label} {current_user['username']} re-enabled {labels}."
        notif_type = "feature_restored"
    else:
        title = f"{labels} disabled"
        eta_text = f" Estimated back in {body.eta_minutes} minutes." if body.eta_minutes else ""
        message_text = f" {body.message}" if body.message else ""
        notif_body = f"{role_label} {current_user['username']} disabled {labels}.{message_text}{eta_text}"
        notif_type = "feature_disabled"
    await notification_repo.notify_all_users(
        notif_type, title, notif_body, related_id=",".join(body.keys))
    log.info("admin: feature flags batch changed by=%s keys=%s enabled=%s",
             current_user["username"], ",".join(body.keys), body.enabled)
    return rows

@api.get("/admin/feature-flags/active-user-count")
async def admin_feature_flags_active_user_count(_: dict = Depends(get_admin)):
    return {"count": len(await user_repo.list_active_non_dev_user_ids())}

@api.get("/feature-status")
async def get_feature_status(current_user: dict | None = Depends(get_current_user_optional)):
    role = current_user.get("role") if current_user else None
    return await _public_status(role)
