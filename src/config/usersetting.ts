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
