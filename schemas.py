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
    is_explicit: bool = False      # 18+/explicit content — hidden from anonymous /explore visitors


class PersonaIn(BaseModel):
    name: str = "You"
    description: str = ""
    is_default: bool = False


class LoreIn(BaseModel):
    content: str
    keys: list[str] | str = []
    always: bool = False
    is_global: bool = Field(False, alias="global")
    image: str = ""
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


class UiTranslateIn(BaseModel):
    lang: str
    strings: dict[str, str]


class LocalizeIn(BaseModel):
    texts: list[str]
    lang: str | None = None   # blank = requester's effective display language


class MessageEdit(BaseModel):
    content: str = ""


class ImageGenIn(BaseModel):
    checkpoint: str | None = None   # override the configured default checkpoint
    lora: str | None = None
    lora_strength: float = 0.8
    positive: str | None = None   # user-edited override — skips the auto-generation call
    negative: str | None = None


class ImageGenStandaloneIn(BaseModel):
    positive: str = ""
    negative: str = ""
    checkpoint: str | None = None
    lora: str | None = None
    lora_strength: float = 0.8


class ImageGenSaveIn(BaseModel):
    image: str   # data URL (data:image/png;base64,...) of the already-generated image
    positive: str = ""
    negative: str = ""


class RenameIn(BaseModel):
    title: str


class LoginIn(BaseModel):
    username: str
    password: str


class UserCreateIn(BaseModel):
    username: str
    password: str
    is_admin: bool = False


class PasswordChangeIn(BaseModel):
    old_password: str
    new_password: str
