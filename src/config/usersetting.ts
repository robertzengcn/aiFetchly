export const USERSDBPATH = "user_dbpath";
export const TOKENNAME = "user-social-market-token";
export const REFRESHTOKEN = "user_refresh_token";
export const TOKENEXPIRY = "user_token_expiry";
export const REFRESHTOKENEXPIRY = "user_refresh_token_expiry";
export const DEVICEIDHASH = "user_device_id_hash";
export const USERSERVICE = "user_service";
export const USERLOGPATH = "user_log";
export const USEREMAIL = "user_email";
export const USERNAME = "user_name";
export const USERTOKEN = "user_token";
export const USERROLES = "user_roles";
export const USERID = "user_id";
export const USERPLANS = "user_plans";
export const USER_AI_ENABLED = "user_ai_enabled";
export const USER_AI_AUTO_PLAN = "user_ai_auto_plan";
/** Redesigned chat workspace flag (PRD §33 rollout). Default "false" —
 * classic dock stays the default until Phase-8 acceptance passes. */
export const USER_AI_CHAT_WORKSPACE_REDESIGN = "user_ai_chat_workspace_redesign";
/**
 * Message-queue kill switches (PRD §18). Queue on = ordinary sends route
 * through durable pending rows; steering requires queue. Disabled queue
 * still lists/resumes/removes existing rows so nothing is orphaned.
 * Values "true"/"false"; default-on.
 */
export const AI_CHAT_MESSAGE_QUEUE_ENABLED = "ai_chat_message_queue_enabled";
export const AI_CHAT_MESSAGE_STEERING_ENABLED =
  "ai_chat_message_steering_enabled";
/**
 * Desktop float notice when the main AI agent finishes a turn or a plan is
 * ready for approval. Stored in system_setting (AI Preferences toggle).
 * Default-on; values "1"/"0" from the settings UI.
 */
export const USER_AI_DESKTOP_NOTIFY = "user_ai_desktop_notify";
/**
 * Local/custom OpenAI-compatible provider availability for AiChatV2.
 * Independent of hosted subscription entitlement (`USER_AI_ENABLED`).
 * Set to "true" when a valid local provider config is saved.
 */
export const USER_LOCAL_AI_ENABLED = "user_local_ai_enabled";
/** Active provider path for AiChatV2: "hosted" (default) or "local". */
export const USER_AI_PROVIDER_MODE = "user_ai_provider_mode";
/** JSON-serialized `LocalAIProviderConfig` (no plaintext API key). */
export const USER_LOCAL_AI_PROVIDER_CONFIG = "user_local_ai_provider_config";
/** Encrypted plaintext API key for the local provider (stored separately). */
export const USER_LOCAL_AI_PROVIDER_API_KEY = "user_local_ai_provider_api_key";

// Hooks system — Phase 4 global enable + builtin enabled-override map.
// Values are strings ("true"/"false") to match the Token store shape.
export const USER_HOOKS_ENABLED = "user_hooks_enabled";
// Value is a JSON string: { [hookId: string]: { enabled: boolean } }
export const USER_HOOKS_BUILTIN_OVERRIDES = "user_hooks_builtin_overrides";

// ==================== AiChatV2 Local Voice Settings ====================
// Local sherpa-onnx voice chat. Values are strings to match the Token store
// shape; typed via AiChatVoiceSettingsView in src/entityTypes/aiChatVoiceTypes.ts.
// See docs/prd/local-sherpa-onnx-voice-chat-technical-design.md §7.
export const AI_CHAT_VOICE_INPUT_MODE = "ai_chat_voice_input_mode";
export const AI_CHAT_VOICE_TTS_MODE = "ai_chat_voice_tts_mode";
export const AI_CHAT_VOICE_AUTO_SEND = "ai_chat_voice_auto_send";
export const AI_CHAT_VOICE_STT_LANGUAGE = "ai_chat_voice_stt_language";
export const AI_CHAT_VOICE_TTS_LANGUAGE = "ai_chat_voice_tts_language";
export const AI_CHAT_VOICE_STT_MODEL_ID = "ai_chat_voice_stt_model_id";
export const AI_CHAT_VOICE_TTS_MODEL_ID = "ai_chat_voice_tts_model_id";
export const AI_CHAT_VOICE_TTS_VOICE_ID = "ai_chat_voice_tts_voice_id";
export const AI_CHAT_VOICE_TTS_SPEED = "ai_chat_voice_tts_speed";
export const AI_CHAT_VOICE_MAX_RECORDING_MS = "ai_chat_voice_max_recording_ms";
