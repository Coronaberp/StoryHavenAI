import inspect

import pytest

pytestmark = pytest.mark.asyncio

EDIT_FUNCTIONS = [
    "set_checkpoint_meta_route",
    "set_checkpoint_preview_video",
    "set_checkpoint_preview_nsfw",
    "clear_checkpoint_preview_nsfw",
    "set_checkpoint_preview",
    "set_lora_meta_route",
    "set_lora_preview_nsfw",
    "clear_lora_preview_nsfw",
    "set_lora_preview",
    "set_sampler_meta_route",
    "set_sampler_preview",
    "set_scheduler_meta_route",
    "set_scheduler_preview",
    "set_upscaler_meta_route",
    "set_upscaler_preview",
]

DELETE_FUNCTIONS = [
    "clear_checkpoint_preview",
    "publish_lora_route",
    "clear_lora_preview",
    "delete_model_file",
    "clear_sampler_preview",
    "clear_scheduler_preview",
    "clear_upscaler_preview",
]


def _capability_dependency(function_name: str):
    from backend.routers import model_previews
    function = getattr(model_previews, function_name)
    signature = inspect.signature(function)
    return signature.parameters["current_user"].default.dependency


@pytest.mark.parametrize("function_name", EDIT_FUNCTIONS)
async def test_edit_denied_without_capability(db_conn, function_name):
    from fastapi import HTTPException
    dependency = _capability_dependency(function_name)
    with pytest.raises(HTTPException) as exc_info:
        await dependency(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("function_name", EDIT_FUNCTIONS)
async def test_edit_allowed_with_capability(db_conn, function_name):
    from backend.repositories import role_capabilities as role_capabilities_repo
    await role_capabilities_repo.grant("member", "model_previews.edit")
    dependency = _capability_dependency(function_name)
    result = await dependency(current_user={"role": "member"})
    assert result == {"role": "member"}


@pytest.mark.parametrize("function_name", DELETE_FUNCTIONS)
async def test_delete_denied_without_capability(db_conn, function_name):
    from fastapi import HTTPException
    dependency = _capability_dependency(function_name)
    with pytest.raises(HTTPException) as exc_info:
        await dependency(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("function_name", DELETE_FUNCTIONS)
async def test_delete_allowed_with_capability(db_conn, function_name):
    from backend.repositories import role_capabilities as role_capabilities_repo
    await role_capabilities_repo.grant("member", "model_previews.delete")
    dependency = _capability_dependency(function_name)
    result = await dependency(current_user={"role": "member"})
    assert result == {"role": "member"}
