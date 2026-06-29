import { SystemSettingGroupdf } from "@/entityTypes/systemsettingType";
import { LlmDatatype } from "@/entityTypes/commonType";
export const volcenginegrouppro = "volcengine-group";
export const volcengineproapiurl = "volcengine-url";
export const volcengineproapikey = "volcengine-key";
export const volcengineapipromodel = "volcengine-model";
export const twocaptcha_enabled = "2captcha-enabled";
export const Doubao_PRO_A: LlmDatatype = {
  groupName: volcenginegrouppro,
  modelName: volcengineapipromodel,
  url: volcengineproapiurl,
  apikey: volcengineproapikey,
};
export const twocaptchagroup = "2captcha-group";
export const twocaptchatoken = "2captcha-token";
export const twocaptchadescription = "2captcha-description";
export const external_system = "external_system";
export const chrome_path = "chrome_path";
export const firefox_path = "firefox_path";
export const user_preferences = "user_preferences";
export const language_preference = "language_preference";
export const ai_website_analysis_business_info =
  "ai_website_analysis_business_info";
export const embedding_group = "embedding_group";
export const embedding_group_description = "embedding_group_description";
export const default_embedding_model = "default_embedding_model";
// AI user-controllable preferences (stored in system_setting table).
// Key strings match the historical Token-based keys for back-compat.
export const ai_preferences = "ai_preferences";
export const ai_preferences_description = "ai-preferences-group-description";
export const ai_auto_dream_enabled = "user_ai_auto_dream";
export const ai_memory_injection_enabled = "user_ai_memory_injection";
export const ai_custom_context_directive = "user_ai_custom_context_directive";
export const settinggroupInit: Array<SystemSettingGroupdf> = [
  {
    name: twocaptchagroup,
    description: twocaptchadescription,
    items: [
      {
        key: twocaptchatoken,
        value: "",
        description: "2captcha-token-description",
        type: "input",
      },
      {
        key: twocaptcha_enabled,
        value: "0",
        description: "2captcha-enabled-description",
        type: "toggle",
      },
    ],
  },
  {
    name: volcenginegrouppro,
    description: "volcengine-group-description",
    items: [
      {
        key: volcengineproapiurl,
        value: "https://ark.cn-beijing.volces.com/api/v3/",
        description: "volcengine-api-url-description",
        type: "input",
      },
      {
        key: volcengineapipromodel,
        value: "doubao-1.5-pro-32k-250115",
        description: "volcengine-api-model-description",
        type: "input",
      },
      {
        key: volcengineproapikey,
        value: "",
        description: "volcengine-api-key-description",
        type: "input",
      },
    ],
  },
  {
    name: embedding_group,
    description: embedding_group_description,
    items: [
      {
        key: default_embedding_model,
        value: "",
        description: "",
        type: "select",
      },
    ],
  },
  {
    name: external_system,
    description: "external-system-group-description",
    items: [
      {
        key: "chrome_path",
        value: "",
        description: "chrome-path-description",
        type: "file",
      },
      {
        key: "firefox_path",
        value: "",
        description: "firefox-path-description",
        type: "file",
      },
    ],
  },
  {
    name: user_preferences,
    description: "user-preferences-group-description",
    items: [
      {
        key: language_preference,
        value: "en",
        description: "language-preference-description",
        type: "select",
      },
      {
        key: ai_website_analysis_business_info,
        value: JSON.stringify({ business: "" }),
        description: "ai-website-analysis-business-info-description",
        type: "input",
      },
    ],
  },
  {
    name: ai_preferences,
    description: ai_preferences_description,
    items: [
      {
        // Auto-dream background consolidation. Default-on per product spec;
        // user can disable via the system settings UI toggle.
        key: ai_auto_dream_enabled,
        value: "1",
        description: "ai-auto-dream-description",
        type: "toggle",
      },
      {
        // Durable user memory prompt injection. Default-on.
        key: ai_memory_injection_enabled,
        value: "1",
        description: "ai-memory-injection-description",
        type: "toggle",
      },
      {
        // User-authored static instructions injected into every AI chat
        // request. Empty by default = no injection. Mirrors CLAUDE.md.
        key: ai_custom_context_directive,
        value: "",
        description: "ai-custom-context-directive-description",
        type: "textarea",
      },
    ],
  },
];
