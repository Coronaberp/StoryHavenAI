import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AVATAR_ALLOWED_PREFIXES = ("/media/", "http://", "https://", "data:image/")
AVATAR_UNSAFE_CHARACTERS = re.compile(r"[\"'<>`\\\s\x00-\x1f]")

def validate_avatar_reference(value: str) -> str:
    if not value:
        return value
    if not value.startswith(AVATAR_ALLOWED_PREFIXES):
        raise ValueError("avatar must be a /media path, an http(s) URL, or a data:image URL")
    if AVATAR_UNSAFE_CHARACTERS.search(value):
        raise ValueError("avatar contains characters that are not allowed in a URL")
    return value

class CharacterIn(BaseModel):
    name: str = "Unnamed"
    description: str = ""
    persona: str = ""
    scenario: str = ""
    greeting: str = ""
    dialogue: str = ""
    system_prompt: str = ""
    tags: list[str] = []
    creator: str = "you"
    avatar: str = ""
    alt_greetings: list[str] = []
    mode: str = "character"
    assets: dict | None = None
    is_public: bool = False
    presentation_html: str = ""
    can_be_persona: bool = False
    allow_download: bool = False
    is_explicit: bool = False
    is_draft: bool = False
    appearance_tags: str = ""
    appearance_tags_negative: str = ""

    @field_validator("avatar")
    @classmethod
    def check_avatar(cls, value: str) -> str:
        return validate_avatar_reference(value)

    @model_validator(mode="after")
    def check_prompt_fields_combined_length(self):
        combined = len(self.system_prompt) + len(self.persona) + len(self.scenario) + len(self.dialogue)
        if combined > 40000:
            raise ValueError(
                f"system_prompt, persona, scenario, and dialogue combined must be 40000 "
                f"characters or fewer (currently {combined})")
        return self

class GenerateCharacterIn(BaseModel):
    description: str = ""

class ExpandPersonaIn(BaseModel):
    text: str = ""

class PersonaIn(BaseModel):
    name: str = "You"
    description: str = ""
    gender: str = ""
    avatar: str = ""
    avatar_data: str | None = None
    is_default: bool = False
    is_draft: bool = False
    session_id: str | None = None

    @field_validator("avatar")
    @classmethod
    def check_avatar(cls, value: str) -> str:
        return validate_avatar_reference(value)

class LoreIn(BaseModel):
    content: str
    keys: list[str] | str = []
    require_keys: list[str] | str = []
    exclude_keys: list[str] | str = []
    always: bool = False
    is_global: bool = Field(False, alias="global")
    image: str = ""
    image_data: str | None = None
    category: str = ""
    hidden: bool = False
    name: str = ""
    appearance_tags: str = ""
    appearance_tags_negative: str = ""
    model_config = {"populate_by_name": True}

class LoreChunkPreviewIn(BaseModel):
    content: str = ""

class LorePersonaToggleIn(BaseModel):
    value: bool

class LoreLinkIn(BaseModel):
    target_id: str
    label: str = Field("", max_length=60)

class LoreLinksIn(BaseModel):
    links: list[LoreLinkIn] = []

class SessionLoreOverrideIn(BaseModel):
    content: str | None = None

class SessionIn(BaseModel):
    persona_id: str | None = None
    greeting_index: int = 0
    language: str | None = None

class ChatIn(BaseModel):
    content: str = ""
    think: bool | None = None
    directive: Literal["ooc", "scene", "note", "time", "as"] | None = None
    directive_arg: str | None = None

class RollIn(BaseModel):
    expr: str = "1d20"
    think: bool | None = None
    note: str = ""

class ModelRequestHostIn(BaseModel):
    host: str
    api_key: str = ""

class OauthProviderConfigIn(BaseModel):
    client_id: str = ""
    client_secret: str | None = None
    enabled: bool = False

class OauthProvidersPutIn(BaseModel):
    providers: dict[str, OauthProviderConfigIn]

class SettingsIn(BaseModel):
    base_url: str | None = None
    embed_base_url: str | None = None
    api_key: str | None = None
    embed_api_key: str | None = None
    chat_model: str | None = None
    embed_model: str | None = None
    embed_dim: int | None = None
    history_turns: int | None = None
    enable_thinking: bool | None = None
    memory_v2: bool | None = None
    memory_v2_budget_tokens: int | None = None
    scene_style: bool | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    top_k: int | None = None
    min_p: float | None = None
    top_a: float | None = None
    typical_p: float | None = None
    tfs: float | None = None
    repetition_penalty: float | None = None
    repetition_penalty_range: int | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    mirostat_mode: int | None = None
    mirostat_tau: float | None = None
    mirostat_eta: float | None = None
    smoothing_factor: float | None = None
    dynatemp_low: float | None = None
    dynatemp_high: float | None = None
    dry_multiplier: float | None = None
    dry_base: float | None = None
    dry_allowed_length: int | None = None
    xtc_threshold: float | None = None
    xtc_probability: float | None = None
    seed: int | None = None
    stop: list[str] | None = None
    extra_params: dict | None = None
    system_suffix: str | None = None
    post_history: str | None = None
    default_language: str | None = None
    comfyui_url: str | None = None
    comfyui_checkpoint: str | None = None
    comfyui_workflow: str | None = None
    image_provider: str | None = None
    image_provider_url: str | None = None
    image_provider_key: str | None = None
    image_provider_model: str | None = None
    model_request_hosts: list[ModelRequestHostIn] | None = None
    embed_link_hosts: list[str] | None = None
    modal_train_url: str | None = None
    modal_shared_secret: str | None = None
    modal_checkpoint_url: str | None = None
    giphy_api_key: str | None = None
    gpu_temp_limit: int | None = None
    gpu_temp_resume: int | None = None
    wan_unet_name: str | None = None
    wan_clip_name: str | None = None
    wan_vae_name: str | None = None

class UserSettingsIn(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    chat_model: str | None = None
    history_turns: int | None = None
    enable_thinking: bool | None = None
    scene_style: bool | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    top_k: int | None = None
    min_p: float | None = None
    top_a: float | None = None
    typical_p: float | None = None
    tfs: float | None = None
    repetition_penalty: float | None = None
    repetition_penalty_range: int | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    mirostat_mode: int | None = None
    mirostat_tau: float | None = None
    mirostat_eta: float | None = None
    smoothing_factor: float | None = None
    dynatemp_low: float | None = None
    dynatemp_high: float | None = None
    dry_multiplier: float | None = None
    dry_base: float | None = None
    dry_allowed_length: int | None = None
    xtc_threshold: float | None = None
    xtc_probability: float | None = None
    seed: int | None = None
    stop: list[str] | None = None
    extra_params: dict | None = None
    system_suffix: str | None = None
    post_history: str | None = None
    interface_language: str | None = None

class StyleIn(BaseModel):
    key: str = "unspecified"
    prompt: str | None = None

class LengthIn(BaseModel):
    key: str = "epic"

class ExplicitModeIn(BaseModel):
    enabled: bool

class LanguageIn(BaseModel):
    language: str | None = None

class PersonaSwitchIn(BaseModel):
    persona_id: str | None = None

class AuthorNoteIn(BaseModel):
    note: str | None = None

class GlossaryIn(BaseModel):
    glossary: dict[str, str] = {}

class ProfileIn(BaseModel):
    display_name: str | None = None
    bio: str | None = None
    banner_color: str | None = None
    accent_color: str | None = None
    avatar: str | None = None
    banner_img: str | None = None
    chat_background_img: str | None = None
    social_links: dict[str, str] | None = None
    profile_html: str | None = None
    card_html: str | None = None
    title: str | None = None

class UiTranslateIn(BaseModel):
    lang: str
    strings: dict[str, str]

class ResyncUiTranslationsIn(BaseModel):
    strings: dict[str, str]

class LocalizeIn(BaseModel):
    texts: list[str]
    lang: str | None = None

class MessageEdit(BaseModel):
    content: str = ""

class LoraSpec(BaseModel):
    name: str
    strength: float = 0.8

class ImageGenIn(BaseModel):
    checkpoint: str | None = None
    loras: list[LoraSpec] = []
    positive: str | None = None
    negative: str | None = None
    reference_image: str | None = None
    denoise: float = 0.6
    architecture: str = "sdxl"
    width: int = 1024
    height: int = 1024
    sampler: str | None = None
    scheduler: str | None = None
    steps: int = 20
    cfg: float = 7.0

class ImagePromptFromDescriptionIn(BaseModel):
    description: str

class ImageGenStandaloneIn(BaseModel):
    positive: str = ""
    negative: str = ""
    checkpoint: str | None = None
    loras: list[LoraSpec] = []
    reference_image: str | None = None
    denoise: float = 0.6
    width: int = 1024
    height: int = 1024
    sampler: str | None = None
    scheduler: str | None = None
    steps: int = 20
    cfg: float = 7.0
    architecture: str = "sdxl"

class ImageGenUpscaleIn(BaseModel):
    image: str
    upscaler: str | None = None

class ImageGenSaveIn(BaseModel):
    image: str
    positive: str = ""
    negative: str = ""
    checkpoint: str = ""
    loras: list[LoraSpec] = []
    sampler: str = ""
    scheduler: str = ""
    steps: int = 20
    is_img2img: bool = False
    cfg: float = 7.0
    upscaler: str = ""
    source_image_id: str | None = None

class ImageGenInpaintIn(BaseModel):
    image: str
    mask: str
    positive: str = ""
    negative: str = ""
    checkpoint: str | None = None
    denoise: float = 1.0
    sampler: str | None = None
    scheduler: str | None = None
    steps: int = 20
    cfg: float = 7.0
    architecture: str = "sdxl"

class ImageGenVideoIn(BaseModel):
    positive: str = ""
    negative: str = ""
    image: str | None = None
    unet_name: str | None = None
    clip_name: str | None = None
    vae_name: str | None = None
    fps: int = 16
    num_frames: int = 33
    width: int = 832
    height: int = 480
    steps: int = 20
    cfg: float = 6.0

class ImageShareIn(BaseModel):
    is_explicit: bool = False

class ImageRatingReportIn(BaseModel):
    claimed_explicit: bool
    note: str | None = None

class ImageReportResolveIn(BaseModel):
    is_explicit: bool
    admin_note: str | None = None

class ContentReportIn(BaseModel):
    kind: str
    label: str
    target_id: str | None = None
    image: str | None = None
    note: str | None = None

class ContentReportResolveIn(BaseModel):
    is_explicit: bool

class LoraPublishIn(BaseModel):
    published: bool

class ModelRequestIn(BaseModel):
    model_name: str
    source_url: str
    note: str = ""
    request_type: str = "checkpoint"
    vae_url: str | None = None
    text_encoder_url: str | None = None

class LoraTrainingJobIn(BaseModel):
    name: str
    trigger_word: str = "sks"
    base_checkpoint: str = ""
    resolution: int = 512
    rank: int = 16
    alpha: int = 16
    learning_rate: float = 0.0001
    steps: int = 1000
    batch_size: int = 1
    noise_offset: float = 0.0
    network_dropout: float = 0.0

class RenameIn(BaseModel):
    title: str

class EmojiUpdateIn(BaseModel):
    shortcode: str | None = None
    kind: str | None = None

class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    totp_code: str | None = Field(default=None, min_length=6, max_length=10)

class WebauthnRegisterVerifyIn(BaseModel):
    challenge_id: str = Field(min_length=1, max_length=64)
    credential: dict
    nickname: str | None = Field(default=None, max_length=60)
    transports: list[str] | None = None

class WebauthnLoginVerifyIn(BaseModel):
    challenge_id: str = Field(min_length=1, max_length=64)
    credential: dict

class PasskeyRequiredIn(BaseModel):
    value: bool

class RegisterIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    totp_secret: str | None = Field(default=None, min_length=1)
    totp_code: str | None = Field(default=None, min_length=6, max_length=6, pattern=r"^\d{6}$")
    invite_code: str | None = Field(default=None, min_length=1, max_length=64)
    guest: bool = False

class InviteCodeIn(BaseModel):
    max_uses: int = Field(default=1, ge=1, le=100)
    expires_days: float | None = Field(default=None, gt=0, le=365)
    note: str | None = Field(default=None, max_length=120)
    tier: Literal["full", "guest"] = "full"

class UserTierIn(BaseModel):
    tier: Literal["full", "guest"]

class TotpProvisionIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)

class TotpEnableIn(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")

class TotpDisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=10)

class TotpPasswordResetIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    code: str = Field(min_length=6, max_length=10)
    new_password: str = Field(min_length=8, max_length=128)

class TotpLoginEnforcementIn(BaseModel):
    required: bool
    code: str = Field(min_length=6, max_length=10)

class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    is_admin: bool = False

class PasswordChangeIn(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

class PasswordResetRequestIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)

class NsfwAllowedIn(BaseModel):
    allowed: bool

class ExperimentalFeaturesIn(BaseModel):
    enabled: bool

class MultiplayerJoinIn(BaseModel):
    token: str
    persona_id: str | None = None

class MultiplayerAcceptIn(BaseModel):
    persona_id: str | None = None

class PartyChatIn(BaseModel):
    content: str = ""
    image: str | None = None
    attachment_kind: str | None = None

class SuspendUserIn(BaseModel):
    reason: str | None = None

class DevRoleIn(BaseModel):
    is_dev: bool

class AdminNoteIn(BaseModel):
    note: str

class IdentityLabelIn(BaseModel):
    label: str | None = None

class ModelMetaIn(BaseModel):
    display_name: str | None = None
    description: str | None = None
    model_type: str | None = None
    default_steps: int | None = None
    model_category: list[str] | None = None
    anima_clip_name: str | None = None
    anima_vae_name: str | None = None
    keywords: list[str] | None = None

class CommentIn(BaseModel):
    target_type: str
    target_id: str
    content: str
    parent_id: str | None = None
    image: str = ""
    attachment_kind: str = ""

class CommentEditIn(BaseModel):
    content: str

class CommentReactIn(BaseModel):
    emoji: str
    super: bool = False

class GiphySendIn(BaseModel):
    id: str

class ForumThreadIn(BaseModel):
    title: str
    content: str
    category: str = ""

class ForumVoteIn(BaseModel):
    value: int

class CustomEmojiIn(BaseModel):
    shortcode: str
    kind: str = "emoji"

class BlockIn(BaseModel):
    reason: str = ""

class GroupCreateIn(BaseModel):
    name: str = "Group"
    opening: str = ""
    char_ids: list[str] = []
    mode: str = "roleplay"

class GroupPublishIn(BaseModel):
    session_id: str

class GroupEditIn(BaseModel):
    name: str = "Group"
    opening: str = ""
    char_ids: list[str] = []
    mode: str = "roleplay"

class MuteIn(BaseModel):
    muted: bool = True
