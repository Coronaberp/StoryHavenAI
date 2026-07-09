"""Pydantic models for request bodies. Keeps validation out of the route bodies."""
from pydantic import BaseModel, Field


class CharacterIn(BaseModel):
    name: str = "Unnamed"
    description: str = ""   # public blurb — shown on cards; persona/scenario stay internal
    persona: str = ""
    scenario: str = ""
    greeting: str = ""
    dialogue: str = ""
    system_prompt: str = ""
    tags: list[str] = []
    creator: str = "you"
    avatar: str = ""
    alt_greetings: list[str] = []
    mode: str = "character"   # "character" or "rpg"
    assets: dict | None = None
    is_public: bool = False   # if True, visible in Community to all users
    presentation_html: str = ""   # optional custom HTML/CSS for the character page; sanitized client-side
    can_be_persona: bool = False   # if True, other users can play as this character (persona pool)
    allow_download: bool = False   # if True, other users may export/download this card (chub/ST-style)
    is_explicit: bool = False      # 18+/explicit content — its images render blurred for anyone
                                    # (anon or logged-in) who hasn't opted into mature content
    is_draft: bool = False   # autosaved, unfinished — hidden from Library/Community, shown
                             # only under the owner's own "Pending" tab until they finish it


class GenerateCharacterIn(BaseModel):
    description: str = ""


class ExpandPersonaIn(BaseModel):
    text: str = ""


class PersonaIn(BaseModel):
    name: str = "You"
    description: str = ""
    is_default: bool = False
    is_draft: bool = False


class LoreIn(BaseModel):
    content: str
    keys: list[str] | str = []
    always: bool = False
    is_global: bool = Field(False, alias="global")
    image: str = ""
    image_data: str | None = None   # data:image/...;base64,... — for entries staged
                                     # from a card import, decoded to a real /media file
                                     # on save; takes priority over `image` when set
    category: str = ""
    hidden: bool = False
    name: str = ""
    appearance_tags: str = ""
    appearance_tags_negative: str = ""
    model_config = {"populate_by_name": True}


class SessionIn(BaseModel):
    persona_id: str | None = None


class ChatIn(BaseModel):
    content: str = ""
    think: bool | None = None


class RollIn(BaseModel):
    expr: str = "1d20"
    think: bool | None = None
    note: str = ""


class ModelRequestHostIn(BaseModel):
    host: str
    api_key: str = ""


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
    default_language: str | None = None   # instance-wide default display language
                                          # (used when a user hasn't picked their own)
    comfyui_url: str | None = None
    comfyui_checkpoint: str | None = None
    comfyui_workflow: str | None = None   # optional custom API-format workflow JSON (text);
                                          # blank = use the built-in default txt2img template
    model_request_hosts: list[ModelRequestHostIn] | None = None
    embed_link_hosts: list[str] | None = None


# Per-user overrides: same sampling/endpoint fields as SettingsIn but no embed_dim
# (embed_dim is global — changing it requires rebuilding the shared vector index)
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


class TranslateIn(BaseModel):
    text: str
    target: str | None = None
    sid: str | None = None   # optional session id — lets the translator localize proper
                              # names to their established spelling instead of a bare transliteration


class StyleIn(BaseModel):
    key: str = "unspecified"
    prompt: str | None = None


class LanguageIn(BaseModel):
    language: str | None = None


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
    social_links: dict[str, str] | None = None
    profile_html: str | None = None
    title: str | None = None


class UiTranslateIn(BaseModel):
    lang: str
    strings: dict[str, str]


class LocalizeIn(BaseModel):
    texts: list[str]
    lang: str | None = None   # blank = requester's effective display language


class MessageEdit(BaseModel):
    content: str = ""


class LoraSpec(BaseModel):
    name: str
    strength: float = 0.8


class ImageGenIn(BaseModel):
    checkpoint: str | None = None   # override the configured default checkpoint
    loras: list[LoraSpec] = []   # applied as a chain, in order, same as ComfyUI's own UI
    positive: str | None = None   # user-edited override — skips the auto-generation call
    negative: str | None = None
    reference_image: str | None = None   # data:image/...;base64,... — switches to img2img
    denoise: float = 0.6   # img2img strength: lower = closer to the reference image


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
    image: str   # data URL of the currently-previewed (not-yet-saved) generated image
    upscaler: str | None = None   # defaults to the first available UpscaleModelLoader model


class ImageGenSaveIn(BaseModel):
    image: str   # data URL (data:image/png;base64,...) of the already-generated image
    positive: str = ""
    negative: str = ""
    checkpoint: str = ""
    loras: list[LoraSpec] = []
    sampler: str = ""
    scheduler: str = ""
    steps: int = 20
    is_img2img: bool = False


class ImageShareIn(BaseModel):
    is_explicit: bool = False


class ImageRatingReportIn(BaseModel):
    claimed_explicit: bool
    note: str | None = None


class ImageReportResolveIn(BaseModel):
    is_explicit: bool
    admin_note: str | None = None


class ModelRequestIn(BaseModel):
    model_name: str
    source_url: str
    note: str = ""
    request_type: str = "checkpoint"
    vae_url: str | None = None
    text_encoder_url: str | None = None


class RenameIn(BaseModel):
    title: str


class EmojiUpdateIn(BaseModel):
    shortcode: str | None = None
    kind: str | None = None


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


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


class SuspendUserIn(BaseModel):
    reason: str | None = None


class AdminNoteIn(BaseModel):
    note: str


class IdentityLabelIn(BaseModel):
    label: str | None = None


class ModelMetaIn(BaseModel):
    display_name: str | None = None
    description: str | None = None
    model_type: str | None = None
    default_steps: int | None = None
    # LoRAs only — a LoRA can be classified under more than one compatible
    # architecture (checkpoints no longer expose category selection at all;
    # see the /admin/checkpoint-previews/{name}/meta route).
    model_category: list[str] | None = None
    # Checkpoints only — per-checkpoint Anima text-encoder/VAE override (see
    # /admin/checkpoint-previews/{name}/meta). Null means "no override, use
    # the shared imagegen.ANIMA_CLIP_NAME/ANIMA_VAE_NAME pair".
    anima_clip_name: str | None = None
    anima_vae_name: str | None = None


class CommentIn(BaseModel):
    target_type: str
    target_id: str
    content: str
    parent_id: str | None = None
    image: str = ""   # returned by POST /comments/upload-image, if attached
    attachment_kind: str = ""   # "image" | "video" | "text" — from the same response


class CommentEditIn(BaseModel):
    content: str


class CommentReactIn(BaseModel):
    emoji: str
    super: bool = False


class ForumThreadIn(BaseModel):
    title: str
    content: str
    category: str = ""


class CustomEmojiIn(BaseModel):
    shortcode: str
    kind: str = "emoji"   # "emoji" | "sticker"


class BlockIn(BaseModel):
    reason: str = ""
