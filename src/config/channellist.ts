export const EXTRAMODULECHANNE_LIST = "extramodule:list";
export const EXTRAMODULECHANNE_INSTALL = "extramodule:install";
export const EXTRAMODULECHANNE_UNINSTALL = "extramodule:uninstall";
export const EXTRAMODULECHANNE_MESSAGE = "extramodule:message";
export const OPENDIRECTORY = "open:directory";
export const VIDEODOWNLOAD = "video:download";
export const VIDEODOWNLOAD_MESSAGE = "video:download:message";
export const VIDEODOWNLOAD_ITEM_MESSAGE = "video:download:message";
//export const SYSTEM_MESSAGE='system:message'
export const VIDEODOWNLOAD_LIST = "video:download:list";
export const VIDEODOWNLOAD_TASK_LIST = "video:download:task:list";
export const SOCIALPLATFORM_LIST = "socialplatform:list";
export const SEARCHSCRAPERAPI = "search:scraper";
export const LISTSESARCHRESUT = "list:searchresult";
export const SEARCHEVENT = "search:event";
export const TASKSEARCHRESULTLIST = "search:result:list";
export const SAVESEARCHERRORLOG = "search:save_error_log";
export const CHECKALLPROXY = "check:proxy";
export const CHECKALLPROXYMESSAGE = "check:proxy:message";
export const PROXYLIST = "proxy:list";
export const PROXYDETAIL = "proxy:detail";
export const PROXYSAVE = "proxy:save";
export const PROXYCHECK = "proxy:check";
export const PROXYIMPORT = "proxy:import";
export const PROXYDELETE = "proxy:delete";
export const REMOVEFAILUREPROXY = "remove:failureproxy";
export const REMOVEFAILUREPROXY_MESSAGE = "remove:failureproxy:message";
export const EMAILEXTRACTIONAPI = "email:extraction:api";
export const EMAILEXTRACTIONMESSAGE = "email:extraction:message";
export const LISTEMAILSEARCHTASK = "list:emailsearchtask";
export const EMAILSEARCHTASKRESULT = "email:search:task:result";
export const EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD =
  "email:search:task:error:log:download";

// Email Extraction Task Edit Channels
export const GETEMAILSEARCHTASK = "email:search:task:get";
export const UPDATEEMAILSEARCHTASK = "email:search:task:update";
export const DELETEEMAILSEARCHTASK = "email:search:task:delete";
export const EMAILEXTRACTION_RESULT_EXPORT = "email:extraction:result:export";
export const EMAIL_SEARCH_TASK_KILL = "email:search:task:kill";
export const EMAIL_SEARCH_TASK_START = "email:search:task:start";

export const EMAILMARKETINGTEMPLIST = "email:marketing:template:list";
export const EMAILMARKETINGTEMPDETAIL = "email:marketing:template:detail";
export const EMAILMARKETINGTEMPUPDATE = "email:marketing:template:update";
export const EMAILMARKETINGTEMPREMOVE = "email:marketing:template:remove";
export const EMAILMARKETINGTEMPPREVIEW = "email:marketing:template:preview";
export const EMAILMARKETINGFILTERLIST = "email:marketing:filter:list";
export const EMAILMARKETFILTERDETAIL = "email:marketing:filter:detail";
export const EMAILMARKETFILTERUPDATE = "email:marketing:filter:update";
export const EMAILFILTERDELETE = "email:filter:delete";
//email service
export const EMAILSERVICEUPDATE = "email:service:update";
export const EMAILSERVICEDETAIL = "email:service:detail";
export const EMAILSERVICELIST = "email:service:list";
export const EMAILSERVICEDELETE = "email:service:delete";

//email template
export const EMAILTEMPLATE_LIST = "email:template:list";
export const EMAILTEMPLATE_DETAIL = "email:template:detail";
export const EMAILTEMPLATE_CREATE = "email:template:create";
export const EMAILTEMPLATE_UPDATE = "email:template:update";
export const EMAILTEMPLATE_DELETE = "email:template:delete";
export const EMAILTEMPLATE_BY_TASK = "email:template:by:task";

//buck email send
export const BUCKEMAILSEND = "buck:email:send";
export const BUCKEMAILSENDMESSAGE = "buck:email:send:message";
export const BUCKEMAILTASKLIST = "buck:email:task:list";

export const SENDTESTEMAIL = "send:test:email";
export const RECEIVESENDTESTEMAILMESSAGE = "receive:send:test:email:message";
export const BUCKEMAILTASKSENDLOG = "buck:email:task:sendlog";

// ======== Email receive + AI auto-reply ========
export const EMAIL_RECEIVE_SYNC = "email:receive:sync";
export const EMAIL_RECEIVE_CONNECTION_TEST = "email:receive:connection:test";
export const EMAIL_RECEIVE_MESSAGE_LIST = "email:receive:message:list";
export const EMAIL_RECEIVE_MESSAGE_DETAIL = "email:receive:message:detail";
export const EMAIL_REPLY_MARK_PROCESSED = "email:reply:mark:processed";
export const EMAIL_REPLY_IDENTITY_GET = "email:reply:identity:get";
export const EMAIL_REPLY_IDENTITY_UPDATE = "email:reply:identity:update";
export const EMAIL_REPLY_DRAFT_CREATE = "email:reply:draft:create";
export const EMAIL_REPLY_DRAFT_DETAIL = "email:reply:draft:detail";
export const EMAIL_REPLY_DRAFT_UPDATE = "email:reply:draft:update";
export const EMAIL_REPLY_SEND = "email:reply:send";
// Thread-aware reply reliability (Milestone 1): approval + send-safety.
export const EMAIL_REPLY_DRAFT_APPROVE = "email:reply:draft:approve";
export const EMAIL_REPLY_SEND_ATTEMPT_DETAIL =
  "email:reply:send:attempt:detail";
export const EMAIL_REPLY_DELIVERY_RECONCILE = "email:reply:delivery:reconcile";
export const EMAIL_REPLY_KNOWLEDGE_SCOPE_GET =
  "email:reply:knowledge:scope:get";
export const EMAIL_REPLY_KNOWLEDGE_SCOPE_UPDATE =
  "email:reply:knowledge:scope:update";
export const EMAIL_AUTO_REPLY_AUDIT_LIST = "email:autoreply:audit:list";
export const EMAIL_AUTO_REPLY_AUDIT_DETAIL = "email:autoreply:audit:detail";
export const SOCIALACCOUNTlIST = "socialaccount:list";
export const SOCIALACCOUNTDETAIL = "socialaccount:detail";
export const SOCIALACCOUNTSAVE = "socialaccount:save";
export const SOCIALACCOUNTDELETE = "socialaccount:delete";
export const SOCIAL_ACCOUNT_LOGIN = "socialaccount:login";
export const SOCIAL_ACCOUNT_LOGIN_MESSSAGE = "socialaccount:login:msg";
export const SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES =
  "socialaccount:upload:cookies";
export const SOCIAL_ACCOUNT_CLEAN_COOKIES = "socialaccount:clean:cookies";
export const SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE =
  "socialaccount:show:platformpage";
// Secure session metadata (renderer-safe: no cookie values).
export const SOCIAL_ACCOUNT_SESSION_METADATA = "socialaccount:session:metadata";
// Browser-profile import (feature-flagged; see src/config/featureFlags.ts).
export const SOCIAL_ACCOUNT_BROWSER_IMPORT_AVAILABILITY =
  "socialaccount:browser-import:availability";
export const SOCIAL_ACCOUNT_BROWSER_IMPORT_START =
  "socialaccount:browser-import:start-pairing";
export const SOCIAL_ACCOUNT_BROWSER_IMPORT_CANCEL =
  "socialaccount:browser-import:cancel";
// Main -> renderer import events (progress + terminal result).
export const SOCIAL_ACCOUNT_BROWSER_IMPORT_EVENT =
  "socialaccount:browser-import:event";
export const VIDEODOWNLOADTASK_RETRY = "video:downloadtask:retry";
export const VIDEODOWNLOADITEM_RETRY = "video:downloaditem:retry";
export const VIDEODOWNLOADITEM_EXPLORER = "video:downloaditem:explorer";
export const VIDEODOWNLOADITEM_DELETE = "video:downloaditem:delete";
export const VIDEODOWN_TASK_ERROR_LOG = "video:download:error:log";
export const VIDEODOWNLOAD_ERROR_LOG_DOWNLOAD =
  "video:download:error:log:download";
export const VIDEODOWN_TASK_ERROR_LOG_QUERY =
  "video:download:task:error:log:query";
export const VIDEO_CAPTION_GENERATE = "video:caption:generate";
export const VIDEO_CAPTION_GENERATE_MESSAGE = "video:caption:generate:message";
export const EXTRAMODULE_UPGRADE = "extramodule:upgrade";
export const EXTRAMODULE_UPGRAD_MESSAGE = "extramodule:upgrade:message";
export const VIDEOTASKDOWNLOAD_RETRY_MESSAGE =
  "videotask:download:retry:message";
export const VIDEODOWNLOAD_LOG_QUERY = "video:download:log:query";
export const VIDEODOWNLOAD_DETAIL_QUERY = "video:download:detail:query";
export const VIDEODOWNLOAD_OPEN_CAPTIONFILE = "video:download:open:captionfile";
export const SYSTEM_SETTING_LIST = "system_setting:list";
export const VIDEO_INFORMATION_TRANSLATE = "video:information:translate";
export const VIDEO_VOICE_TRANSLATE = "video:voice:translate";
export const SYSTEM_SETTING_UPDATE = "system_setting:update";
export const QUERY_USER_INFO = "user:info";
export const OPENLOGINPAGE = "open:page";
export const GET_LOGIN_URL = "user:get_login_url";
export const CANCEL_DESKTOP_LOGIN = "user:cancel_desktop_login";
export const USER_LOGIN = "user:Login";
export const NATIVATECOMMAND = "navigate:command";
export const LOGIN_STATUS = "login:status";
export const CHECK_LOGIN_SUCCEEDED = "user:check_login_succeeded";
export const VIDEO_PUBLISH = "video:publish";
export const VIDEO_PUBLISH_RECORD_MESSAGE = "video:publish:record:message";
export const VIDEO_PUBLISH_RECORD_DELETE = "video:publish:record:delete";
export const VIDEO_PUBLISH_RECORD_LIST = "video:publish:record:list";
export const SYSTEM_MESSAGE = "system:message";
export const RETRYSEARCHTASK = "search:retry_task";
export const CHOOSEFILEDIALOG = "choose:file:dialog";

// Search Task Edit Channels
export const GET_SEARCH_TASK_DETAILS = "search:task:get_details";
export const UPDATE_SEARCH_TASK = "search:task:update";
export const SEARCH_TASK_UPDATE_EVENT = "search:task:update:event";
export const CREATE_SEARCH_TASK_ONLY = "search:task:create_only";
export const EXPORT_SEARCH_RESULTS = "search:result:export";
export const KILL_SEARCH_PROCESS = "search:kill_process";

// Schedule Management Channels
export const SCHEDULE_CREATE = "schedule:create";
export const SCHEDULE_UPDATE = "schedule:update";
export const SCHEDULE_DELETE = "schedule:delete";
export const SCHEDULE_ENABLE = "schedule:enable";
export const SCHEDULE_DISABLE = "schedule:disable";
export const SCHEDULE_PAUSE = "schedule:pause";
export const SCHEDULE_RESUME = "schedule:resume";
export const SCHEDULE_RUN_NOW = "schedule:run_now";
export const SCHEDULE_LIST = "schedule:list";
export const SCHEDULE_DETAIL = "schedule:detail";
export const SCHEDULE_BY_TASK_TYPE = "schedule:by_task_type";
export const SCHEDULE_SEARCH = "schedule:search";
export const SCHEDULE_EXPORT = "schedule:export";
export const SCHEDULE_IMPORT = "schedule:import";

// Execution Management Channels
export const EXECUTION_HISTORY = "schedule:execution:history";
export const EXECUTION_STATISTICS = "schedule:execution:statistics";
export const EXECUTION_RECENT = "schedule:execution:recent";

// Dependency Management Channels
export const DEPENDENCY_ADD = "schedule:dependency:add";
export const DEPENDENCY_REMOVE = "schedule:dependency:remove";
export const DEPENDENCY_GRAPH = "schedule:dependency:graph";
export const DEPENDENCY_VALIDATE = "schedule:dependency:validate";

// Scheduler Management Channels
export const SCHEDULER_STATUS = "scheduler:status";
export const SCHEDULER_START = "scheduler:start";
export const SCHEDULER_STOP = "scheduler:stop";
export const SCHEDULER_RELOAD = "scheduler:reload";

// Utility Channels
export const CRON_VALIDATE = "cron:validate";
export const CRON_NEXT_RUN_TIME = "cron:next_run_time";
export const USER_CHECK_LOGIN = "user:checklogin";
export const USER_SIGNOUT = "user:signout";

// App Information Channels
export const GET_APP_INFO = "app:info";

// About / App Update Channels (About aiFetchly page)
/** Renderer→Main: open the allowlisted official website via shell.openExternal. */
export const APP_OPEN_WEBSITE = "app:open:website";
/** Renderer→Main: fetch a snapshot of the current update status. */
export const APP_GET_UPDATE_STATUS = "app:update:status";
/** Renderer→Main: trigger a manual GitHub update check (cooldown + concurrency guarded). */
export const APP_CHECK_FOR_UPDATES = "app:check-for-updates";
/** Renderer→Main: quit and install a downloaded update (only when ready-to-restart). */
export const APP_INSTALL_UPDATE = "app:install-update";
/** Main→Renderer: pushed on every update status state transition. */
export const APP_UPDATE_STATUS_EVENT = "app:update:status:event";

// Platform Management Channels
export const PLATFORM_LIST = "platform:list";
export const PLATFORM_DETAIL = "platform:detail";
export const PLATFORM_CREATE = "platform:create";
export const PLATFORM_UPDATE = "platform:update";
export const PLATFORM_DELETE = "platform:delete";
export const PLATFORM_VALIDATE = "platform:validate";
export const PLATFORM_STATISTICS = "platform:statistics";
export const PLATFORM_TOGGLE = "platform:toggle";

// Yellow Pages Management Channels
export const YELLOW_PAGES_CREATE = "yellow_pages:create";
export const YELLOW_PAGES_UPDATE = "yellow_pages:update";
export const YELLOW_PAGES_DELETE = "yellow_pages:delete";
export const YELLOW_PAGES_START = "yellow_pages:start";
export const YELLOW_PAGES_STOP = "yellow_pages:stop";
export const YELLOW_PAGES_PAUSE = "yellow_pages:pause";
export const YELLOW_PAGES_RESUME = "yellow_pages:resume";
export const YELLOW_PAGES_LIST = "yellow_pages:list";
export const YELLOW_PAGES_DETAIL = "yellow_pages:detail";
export const YELLOW_PAGES_PROGRESS = "yellow_pages:progress";
export const YELLOW_PAGES_RESULTS = "yellow_pages:results";
export const YELLOW_PAGES_EXPORT = "yellow_pages:export";
export const YELLOW_PAGES_BULK = "yellow_pages:bulk";
export const YELLOW_PAGES_HEALTH = "yellow_pages:health";
export const YELLOW_PAGES_PLATFORMS = "yellow_pages:platforms";
export const YELLOW_PAGES_STATISTICS = "yellow_pages:statistics";
export const YELLOW_PAGES_KILL_PROCESS = "yellow_pages:kill_process";
export const YELLOW_PAGES_CHECK_ORPHANED_PROCESSES =
  "yellow_pages:check_orphaned_processes";
export const YELLOW_PAGES_HANDLE_PREVIOUS_SESSION =
  "yellow_pages:handle_previous_session";

// Language Preference Channels
export const LANGUAGE_PREFERENCE_GET = "language:preference:get";
export const LANGUAGE_PREFERENCE_UPDATE = "language:preference:update";

// Website Analysis Channels
export const ANALYZE_WEBSITE = "search:analyze-website";
export const ANALYZE_WEBSITE_PROGRESS = "search:analyze-website:progress";

// RAG (Retrieval-Augmented Generation) Channels
export const RAG_INITIALIZE = "rag:initialize";
export const RAG_QUERY = "rag:query";
export const RAG_UPLOAD_DOCUMENT = "rag:upload-document";
export const RAG_GET_STATS = "rag:get-stats";
export const RAG_TEST_PIPELINE = "rag:test-pipeline";
export const RAG_GET_DOCUMENTS = "rag:get-documents";
export const RAG_GET_DOCUMENT = "rag:get-document";
export const RAG_UPDATE_DOCUMENT = "rag:update-document";
export const RAG_DELETE_DOCUMENT = "rag:delete-document";
export const RAG_GET_DOCUMENT_STATS = "rag:get-document-stats";
export const RAG_SEARCH = "rag:search";
export const RAG_GET_SUGGESTIONS = "rag:get-suggestions";
export const RAG_GET_SEARCH_ANALYTICS = "rag:get-search-analytics";
export const RAG_UPDATE_EMBEDDING_MODEL = "rag:update-embedding-model";
export const RAG_GET_AVAILABLE_MODELS = "rag:get-available-models";
export const RAG_TEST_EMBEDDING_SERVICE = "rag:test-embedding-service";
export const RAG_CLEAR_CACHE = "rag:clear-cache";
export const RAG_CLEANUP = "rag:cleanup";
export const RAG_CHUNK_AND_EMBED_DOCUMENT = "rag:chunk-and-embed-document";
export const RAG_DOWNLOAD_DOCUMENT = "rag:download-document";
export const RAG_GET_DOCUMENT_ERROR_LOG = "rag:get-document-error-log";
export const RAG_CHECK_DOCUMENT_DUPLICATE = "rag:check-document-duplicate";
export const RAG_IMPORT_WEBSITE = "rag:import-website";
export const RAG_IMPORT_WEBSITE_PROGRESS = "rag:import-website:progress";

// File Dialog Channels
export const SHOW_OPEN_DIALOG = "show-open-dialog";
export const GET_FILE_STATS = "get-file-stats";
export const SAVE_TEMP_FILE = "save-temp-file";
export const SAVE_TEMP_FILE_PROGRESS = "save-temp-file:progress";
export const SAVE_TEMP_FILE_COMPLETE = "save-temp-file:complete";

// AI Chat Channels
export const AI_CHAT_MESSAGE = "ai-chat:message";
export const AI_CHAT_STREAM = "ai-chat:stream";
export const AI_CHAT_STREAM_STOP = "ai-chat:stream-stop";
export const AI_CHAT_STREAM_CHUNK = "ai-chat:stream-chunk";
export const AI_CHAT_STREAM_COMPLETE = "ai-chat:stream-complete";
/** Resume a skill/tool call after the user granted permission in the chat UI. */
export const AI_CHAT_RESUME_TOOL_AFTER_PERMISSION =
  "ai-chat:resume-tool-after-permission";
export const AI_CHAT_HISTORY = "ai-chat:history";
export const AI_CHAT_CLEAR = "ai-chat:clear";
export const AI_CHAT_CONVERSATIONS = "ai-chat:conversations";
/** Main->Renderer: file operation record emitted after AI chat file_write/file_edit */
export const AI_FILE_OPERATION = "ai-chat:file-operation";
/** Renderer->Main: open a file in the system default application */
export const AI_FILE_OPEN = "ai-chat:file-open";
export const AI_KEYWORDS_GENERATE = "ai-keywords:generate";

// ==================== AI Chat V2 Channels ====================
export const AI_CHAT_V2_MODELS = "ai-chat-v2:models";
export const AI_CHAT_V2_CONVERSATIONS = "ai-chat-v2:conversations";
export const AI_CHAT_V2_HISTORY = "ai-chat-v2:history";
export const AI_CHAT_V2_STREAM = "ai-chat-v2:stream";
export const AI_CHAT_V2_STREAM_STOP = "ai-chat-v2:stream-stop";
export const AI_CHAT_V2_STREAM_CHUNK = "ai-chat-v2:stream-chunk";
export const AI_CHAT_V2_STREAM_COMPLETE = "ai-chat-v2:stream-complete";
/** Main→Renderer: open AI Chat V2 and select a conversation (desktop notify click). */
export const AI_CHAT_V2_OPEN_FROM_NOTIFY = "ai-chat-v2:open-from-notify";
export const AI_CHAT_V2_CLEAR_CONVERSATION = "ai-chat-v2:clear-conversation";
export const AI_CHAT_V2_CLEAR_ALL = "ai-chat-v2:clear-all";
/** Resume a V2 skill/tool call after the user granted permission in the chat UI. */
export const AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION =
  "ai-chat-v2:resume-tool-after-permission";
// Plan Mode channels
export const AI_CHAT_V2_PLAN_STATE = "ai-chat-v2:plan-state";
export const AI_CHAT_V2_ANSWER_QUESTION = "ai-chat-v2:answer-question";
export const AI_CHAT_V2_APPROVE_PLAN = "ai-chat-v2:approve-plan";
export const AI_CHAT_V2_REJECT_PLAN = "ai-chat-v2:reject-plan";
export const AI_CHAT_V2_REQUEST_PLAN_CHANGES =
  "ai-chat-v2:request-plan-changes";
export const AI_CHAT_V2_PLAN_VERSIONS = "ai-chat-v2:plan-versions";
export const AI_CHAT_V2_COMPACT_CONVERSATION =
  "ai-chat-v2:compact-conversation";
export const AI_CHAT_V2_GET_TOOL_APPROVAL_MODE =
  "ai-chat-v2:get-tool-approval-mode";
export const AI_CHAT_V2_SET_TOOL_APPROVAL_MODE =
  "ai-chat-v2:set-tool-approval-mode";
/** Main->renderer: read cached expanded pasted-text bodies for previews. */
export const AI_CHAT_V2_READ_PASTE_CACHE = "ai-chat-v2:read-paste-cache";
export const AI_CHAT_V2_AT_MENTION_SUGGEST = "ai-chat-v2:at-mention-suggest";

// AI Chat V2 pending-message queue & steering (message-queue PRD §12)
export const AI_CHAT_V2_PENDING_CREATE = "ai-chat-v2:pending-message-create";
export const AI_CHAT_V2_PENDING_LIST = "ai-chat-v2:pending-message-list";
export const AI_CHAT_V2_PENDING_STEER = "ai-chat-v2:pending-message-steer";
export const AI_CHAT_V2_PENDING_CANCEL = "ai-chat-v2:pending-message-cancel";
export const AI_CHAT_V2_PENDING_RESUME = "ai-chat-v2:pending-message-resume";
export const AI_CHAT_V2_PENDING_EVENT = "ai-chat-v2:pending-message-event";
export const AI_CHAT_V2_GOAL_CREATE = "ai-chat-v2:goal-create";
export const AI_CHAT_V2_GOAL_GET = "ai-chat-v2:goal-get";
export const AI_CHAT_V2_GOAL_LOOP_START = "ai-chat-v2:goal-loop-start";
export const AI_CHAT_V2_GOAL_LOOP_STOP = "ai-chat-v2:goal-loop-stop";
export const AI_CHAT_V2_GOAL_EVENT = "ai-chat-v2:goal-event";
// AI Chat V2 Scheduled Loop channels (renderer->main invoke + main->renderer broadcast).
// Handlers check USER_AI_ENABLED before parsing payloads (FR-17, technical-design §12.2).
export const AI_CHAT_V2_SCHEDULED_LOOP_CREATE =
  "ai-chat-v2:scheduled-loop-create";
export const AI_CHAT_V2_SCHEDULED_LOOP_GET = "ai-chat-v2:scheduled-loop-get";
export const AI_CHAT_V2_SCHEDULED_LOOP_PAUSE =
  "ai-chat-v2:scheduled-loop-pause";
export const AI_CHAT_V2_SCHEDULED_LOOP_RESUME =
  "ai-chat-v2:scheduled-loop-resume";
export const AI_CHAT_V2_SCHEDULED_LOOP_STOP = "ai-chat-v2:scheduled-loop-stop";
export const AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN =
  "ai-chat-v2:scheduled-loop-stop-run";
/** Main->renderer refresh hint after a scheduled turn persists (FR-11). */
export const AI_CHAT_V2_CONVERSATION_UPDATED =
  "ai-chat-v2:conversation-updated";
/** Main->renderer live scheduled-turn token stream (technical-design §13.2). */
export const AI_CHAT_V2_SCHEDULED_STREAM = "ai-chat-v2:scheduled-stream";
/** Main->renderer broadcast after an automatic full compact so the renderer
 * drops the context badge immediately (mirrors the manual compact flow). */
export const AI_CHAT_V2_AUTO_COMPACTED = "ai-chat-v2:auto-compacted";

// ==================== AiChatV2 Local Voice Channels ====================
// Local sherpa-onnx STT/TTS for AiChatV2. See
// docs/prd/local-sherpa-onnx-voice-chat-technical-design.md §6.
// Handlers validate payloads (mime/size/text-length) before any worker call.
/** Renderer->Main: read voice runtime + model availability. */
export const AI_CHAT_V2_VOICE_STATUS = "ai-chat-v2:voice-status";
/** Renderer->Main: transcribe a recorded audio payload (push-to-talk STT). */
export const AI_CHAT_V2_VOICE_TRANSCRIBE = "ai-chat-v2:voice-transcribe";
/** Renderer->Main: synthesize speech (TTS) from sanitized assistant text. */
export const AI_CHAT_V2_VOICE_TTS = "ai-chat-v2:voice-tts";
/** Renderer->Main: best-effort cancel of active STT/TTS work. */
export const AI_CHAT_V2_VOICE_CANCEL = "ai-chat-v2:voice-cancel";
/** Renderer->Main: read voice settings view. */
export const AI_CHAT_V2_VOICE_GET_SETTINGS = "ai-chat-v2:voice-get-settings";
/** Renderer->Main: validate + persist voice settings view. */
export const AI_CHAT_V2_VOICE_SET_SETTINGS = "ai-chat-v2:voice-set-settings";
// Phase 5: model download channels
export const AI_CHAT_V2_VOICE_MODEL_LIST = "ai-chat-v2:voice-model-list";
export const AI_CHAT_V2_VOICE_MODEL_DOWNLOAD =
  "ai-chat-v2:voice-model-download";
export const AI_CHAT_V2_VOICE_MODEL_DOWNLOAD_PROGRESS =
  "ai-chat-v2:voice-model-download-progress";
export const AI_CHAT_V2_VOICE_MODEL_CANCEL_DOWNLOAD =
  "ai-chat-v2:voice-model-cancel-download";

// AI Provider (Local/Custom) Settings Channels
export const AI_PROVIDER_SETTINGS_GET = "ai-provider:settings:get";
export const AI_PROVIDER_SETTINGS_SAVE = "ai-provider:settings:save";
export const AI_PROVIDER_MODELS_REFRESH = "ai-provider:models:refresh";
export const AI_PROVIDER_CONNECTION_TEST = "ai-provider:connection:test";
export const AI_PROVIDER_API_KEY_CLEAR = "ai-provider:api-key:clear";

// ==================== Slash Command + AiFetchly Config Channels ==============
// Phase 13 (Plan 03b) — see docs/prd/aifetchly-local-extensibility-technical-design.md §17.1.
//
// TRS-05 Strategy A: every invoke handler below uses registerValidatedHandler
// (NOT registerAiValidatedHandler). Built-in dispatch returns show_result
// (no AI call); prompt commands return submit_prompt and the renderer submits
// via AI_CHAT_V2_STREAM which already gates USER_AI_ENABLED FIRST (verified
// at ai-chat-v2-ipc.ts handleStream lines 385-393).
/** Renderer->Main: list renderer-safe slash commands (CMD-07 ranking). */
export const SLASH_COMMAND_LIST = "slash-command:list";
/** Renderer->Main: dispatch one composer submission (CMD-04). */
export const SLASH_COMMAND_DISPATCH = "slash-command:dispatch";
/** Renderer->Main: force a config rescan (DX-02 + success criterion 3). */
export const AIFETCHLY_CONFIG_RELOAD = "aifetchly-config:reload";
/** Renderer->Main: read config status counts (DX-02). */
export const AIFETCHLY_CONFIG_STATUS = "aifetchly-config:status";
/**
 * Main->Renderer EVENT (NOT an invoke handler): emitted via
 * win.webContents.send after a successful reload so the renderer refreshes
 * its command cache. Payload is JSON-stringified {source, summary}.
 *
 * Phase 14 (Plan 14-03 D-04): the payload is additively extended with
 * optional `workspaceId` + `diff` for workspace-originated changes. The
 * existing `{source: "user", summary}` shape is preserved; subscribers
 * that ignore the payload (Phase 13-04 AiChatV2 subscriber) keep working.
 */
export const AIFETCHLY_CONFIG_CHANGED = "aifetchly-config:changed";

// ==================== Workspace Watcher Channels (Phase 14 — Plan 03) =======
// Renderer->Main invoke handlers that drive the workspace-config watcher
// lifecycle. See docs/prd/aifetchly-local-extensibility-technical-design.md
// §10.1 (chat-open acquire flow), §10.4 (switch flow), §13 (trust prompt IPC).
//
// Trust boundary (CFG-02): the handlers NEVER trust a renderer-provided
// workspaceRoot — WorkspaceResolver.resolve(conversationId) is the sole
// source of truth for the watched path. The renderer may pass a workspaceId
// hint (the string returned by acquire), but main always re-resolves the
// root from the approved WorkspaceRecord before forwarding to the manager.
/** Renderer->Main: acquire a watch for the active workspace (chat-open). */
export const AIFETCHLY_WORKSPACE_WATCH_ACQUIRE =
  "aifetchly-workspace-watch:acquire";
/** Renderer->Main: release a watch consumer (chat-close / unmount). */
export const AIFETCHLY_WORKSPACE_WATCH_RELEASE =
  "aifetchly-workspace-watch:release";
/**
 * Renderer->Main: read the trusted workspace AGENTS.md content body for the
 * trust-prompt preview (TRS-07 — renderer never reads the file directly;
 * main returns the content string, never a path).
 */
export const AIFETCHLY_WORKSPACE_TRUST_PREVIEW =
  "aifetchly-workspace-trust:preview";
/** Renderer->Main: set workspace trust scope (TRS-03 prompt actions). */
export const AIFETCHLY_WORKSPACE_TRUST_SET = "aifetchly-workspace-trust:set";

// MCP Tool Management Channels
export const MCP_TOOL_LIST = "mcp:tool:list";
export const MCP_TOOL_ADD = "mcp:tool:add";
export const MCP_TOOL_UPDATE = "mcp:tool:update";
export const MCP_TOOL_DELETE = "mcp:tool:delete";
export const MCP_TOOL_DISCOVER = "mcp:tool:discover";
export const MCP_TOOL_TOGGLE_SERVER = "mcp:tool:toggle:server";
export const MCP_TOOL_TOGGLE_TOOL = "mcp:tool:toggle:tool";
export const MCP_TOOL_TEST_CONNECTION = "mcp:tool:test:connection";
export const MCP_TOOL_TRUST = "mcp:tool:trust";

// Skill Management Channels
export const SKILL_CHECK_PERMISSION = "skill:check-permission";
export const SKILL_GRANT_PERMISSION = "skill:grant-permission";
export const SKILL_DENY_PERMISSION = "skill:deny-permission";
export const SKILL_REVOKE_PERMISSION = "skill:revoke-permission";
export const SKILL_GET_PERMISSION_STATUS = "skill:get-permission-status";

// Skill Import & Management Channels
export const SKILL_IMPORT = "skill:import";
export const SKILL_LIST_INSTALLED = "skill:list-installed";
export const SKILL_TOGGLE = "skill:toggle";
export const SKILL_UNINSTALL = "skill:uninstall";

// System Dependency Channels
export const SYSTEM_DEPENDENCY_RESOLVE = "system-dependency:resolve";
export const SYSTEM_DEPENDENCY_INSTALL = "system-dependency:install";
export const SYSTEM_DEPENDENCY_GET_AUDIT_LOG =
  "system-dependency:get-audit-log";
/** Main→Renderer: ask user to approve a dependency install (includes resolution result). */
export const SYSTEM_DEPENDENCY_PROMPT = "system-dependency:prompt";
/** Renderer→Main: user responded to the dependency install prompt. */
export const SYSTEM_DEPENDENCY_PROMPT_RESPONSE =
  "system-dependency:prompt-response";

// Dashboard Channels
export const DASHBOARD_SUMMARY = "dashboard:summary";
export const DASHBOARD_TRENDS = "dashboard:trends";
export const DASHBOARD_SEARCH_ENGINES = "dashboard:search_engines";
export const DASHBOARD_EMAIL_STATUS = "dashboard:email_status";

// WebSocket Channels
export const WEBSOCKET_EVENT = "websocket:event";
export const WEBSOCKET_CONNECT = "websocket:connect";
export const WEBSOCKET_DISCONNECT = "websocket:disconnect";
export const WEBSOCKET_RECONNECT = "websocket:reconnect";
export const WEBSOCKET_STATUS = "websocket:status";
export const WEBSOCKET_SEND = "websocket:send";

// Contact Extraction Channels
export const START_CONTACT_EXTRACTION = "start-contact-extraction";
export const CONTACT_EXTRACTION_PROGRESS = "contact-extraction-progress";
export const GET_CONTACT_INFO = "get-contact-info";
export const RETRY_CONTACT_EXTRACTION = "retry-contact-extraction";

// AI Email Template Generation Channels
export const AI_EMAIL_TEMPLATE_GENERATE_STREAM =
  "ai-email-template:generate-stream";
export const AI_EMAIL_TEMPLATE_GENERATE_CHUNK =
  "ai-email-template:generate-chunk";
export const AI_EMAIL_TEMPLATE_GENERATE_COMPLETE =
  "ai-email-template:generate-complete";
export const AI_EMAIL_TEMPLATE_ERROR = "ai-email-template:error";
export const AI_EMAIL_TEMPLATE_STOP = "ai-email-template:stop";
export const AI_EMAIL_TEMPLATE_VALIDATE = "ai-email-template:validate";
export const AI_EMAIL_TEMPLATE_GENERATE = "ai-email-template:generate";

// Google Maps Scraper Channels
export const GOOGLE_MAPS_SEARCH_START = "google_maps:search_start";
export const GOOGLE_MAPS_SEARCH_CANCEL = "google_maps:search_cancel";
export const GOOGLE_MAPS_SEARCH_PROGRESS = "google_maps:search_progress";
export const GOOGLE_MAPS_SEARCH_RESULT = "google_maps:search_result";
export const GOOGLE_MAPS_HISTORY_LIST = "google_maps:history_list";
export const GOOGLE_MAPS_HISTORY_DETAIL = "google_maps:history_detail";
export const GOOGLE_MAPS_HISTORY_DELETE = "google_maps:history_delete";

// Yandex Maps Scraper Channels
export const YANDEX_MAPS_SEARCH_START = "yandex_maps:search_start";
export const YANDEX_MAPS_SEARCH_CANCEL = "yandex_maps:search_cancel";
export const YANDEX_MAPS_SEARCH_PROGRESS = "yandex_maps:search_progress";
export const YANDEX_MAPS_SEARCH_RESULT = "yandex_maps:search_result";
export const YANDEX_MAPS_HISTORY_LIST = "yandex_maps:history_list";
export const YANDEX_MAPS_HISTORY_DETAIL = "yandex_maps:history_detail";
export const YANDEX_MAPS_HISTORY_DELETE = "yandex_maps:history_delete";

// AI Message Task Channels
export const AI_MESSAGE_TASK_CREATE = "ai-message-task:create";
export const AI_MESSAGE_TASK_UPDATE = "ai-message-task:update";
export const AI_MESSAGE_TASK_DELETE = "ai-message-task:delete";
export const AI_MESSAGE_TASK_LIST = "ai-message-task:list";
export const AI_MESSAGE_TASK_DETAIL = "ai-message-task:detail";
export const AI_MESSAGE_TASK_RUN_LIST = "ai-message-task:run-list";
export const AI_MESSAGE_TASK_RUN_DETAIL = "ai-message-task:run-detail";
export const AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS =
  "ai-message-task:list-available-tools";

// ==================== Agent Runtime Channels ====================
export const AGENT_DEFINITION_LIST = "agent-runtime:definition-list";
export const AGENT_TASK_DETAIL = "agent-runtime:task-detail";
export const AGENT_TASK_TRANSCRIPT = "agent-runtime:task-transcript";
export const AGENT_TASK_LIST = "agent-runtime:task-list";
export const AGENT_RESUME_TOOL_AFTER_PERMISSION =
  "agent-runtime:resume-tool-after-permission";

// ==================== Agent Definition Management Channels ====================
// Management-only (CRUD/enablement). NOT AI execution channels — handlers use
// registerValidatedHandler, not registerAiValidatedHandler (design §15.5).
export const AGENT_MANAGEMENT_LIST = "agent-definition:list";
export const AGENT_MANAGEMENT_GET = "agent-definition:get";
export const AGENT_MANAGEMENT_CREATE = "agent-definition:create";
export const AGENT_MANAGEMENT_UPDATE = "agent-definition:update";
export const AGENT_MANAGEMENT_TOGGLE = "agent-definition:toggle";
export const AGENT_MANAGEMENT_DELETE = "agent-definition:delete";

// ==================== Plugin Management Channels (Design §10) ====================
export const PLUGIN_IMPORT = "plugin:import";
export const PLUGIN_VALIDATE_PACKAGE = "plugin:validate-package";
export const PLUGIN_LIST = "plugin:list";
export const PLUGIN_GET = "plugin:get";
export const PLUGIN_TOGGLE = "plugin:toggle";
export const PLUGIN_UNINSTALL = "plugin:uninstall";
export const PLUGIN_RELOAD = "plugin:reload";
export const PLUGIN_EXPORT_DIAGNOSTICS = "plugin:export-diagnostics";
export const PLUGIN_TOGGLE_SKILL = "plugin:toggle-skill";
export const PLUGIN_TOGGLE_MCP_SERVER = "plugin:toggle-mcp-server";
export const PLUGIN_TOGGLE_MCP_TOOL = "plugin:toggle-mcp-tool";
export const PLUGIN_TEST_MCP_CONNECTION = "plugin:test-mcp-connection";
export const PLUGIN_DISCOVER_MCP_TOOLS = "plugin:discover-mcp-tools";
export const PLUGIN_INSTALL_FROM_SOURCE = "plugin:install-from-source";
export const PLUGIN_GET_MCP_OPTIONS = "plugin:get-mcp-options";
export const PLUGIN_SET_MCP_OPTION = "plugin:set-mcp-option";

// ==================== Plugin Marketplace Channels (Marketplace PRD §11.1) ====================
export const PLUGIN_MARKETPLACE_LIST = "plugin:marketplace:list";
export const PLUGIN_MARKETPLACE_GET = "plugin:marketplace:get";
export const PLUGIN_MARKETPLACE_ADD = "plugin:marketplace:add";
export const PLUGIN_MARKETPLACE_REFRESH = "plugin:marketplace:refresh";
export const PLUGIN_MARKETPLACE_REMOVE = "plugin:marketplace:remove";
export const PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS =
  "plugin:marketplace:available-plugins";
export const PLUGIN_MARKETPLACE_GET_PLUGIN = "plugin:marketplace:get-plugin";
export const PLUGIN_MARKETPLACE_INSTALL_PLUGIN =
  "plugin:marketplace:install-plugin";

// ==================== Community Plugins Channels (Community Plugin Page PRD §7.3) ====================
// NON-AI-gated: Free (Community) users must be able to browse the catalog
// (precedent: plugin-ipc.ts — "plugin management is NOT an AI feature").
export const PLUGIN_COMMUNITY_LIST = "plugin:community:list";
export const PLUGIN_COMMUNITY_DETAIL = "plugin:community:detail";
export const PLUGIN_COMMUNITY_INSTALL = "plugin:community:install";
/** Renderer→Main: open the marketing plans page (Upgrade CTA) via shell.openExternal. */
export const PLUGIN_COMMUNITY_OPEN_PLANS = "plugin:community:open-plans";

// AI user memory (durable cross-session memory)
export const AI_USER_MEMORY_LIST = "ai:user-memory:list";
// AI Artifacts (read; creation happens through the Chat V2 stream tool)
export const AI_ARTIFACT_GET = "ai-artifact:get";
export const AI_ARTIFACT_LIST = "ai-artifact:list";
export const AI_USER_MEMORY_CREATE = "ai:user-memory:create";
export const AI_USER_MEMORY_UPDATE = "ai:user-memory:update";
export const AI_USER_MEMORY_ARCHIVE = "ai:user-memory:archive";
export const AI_USER_MEMORY_DELETE = "ai:user-memory:delete";
export const AI_USER_MEMORY_RUN_AUTO_DREAM = "ai:user-memory:auto-dream:run";
export const AI_USER_MEMORY_AUTO_DREAM_STATUS =
  "ai:user-memory:auto-dream:status";

// Portable workspace memory (Markdown files under .aifetchly/memory/)
// Non-AI operations — available without an AI subscription (design §20.4).
export const AI_PORTABLE_WORKSPACE_MEMORY_STATUS =
  "ai:portable-workspace-memory:status";
export const AI_PORTABLE_WORKSPACE_MEMORY_LIST =
  "ai:portable-workspace-memory:list";
export const AI_PORTABLE_WORKSPACE_MEMORY_CREATE =
  "ai:portable-workspace-memory:create";
export const AI_PORTABLE_WORKSPACE_MEMORY_UPDATE =
  "ai:portable-workspace-memory:update";
export const AI_PORTABLE_WORKSPACE_MEMORY_ARCHIVE_PORTABLE =
  "ai:portable-workspace-memory:archive-portable";
export const AI_PORTABLE_WORKSPACE_MEMORY_DELETE_PORTABLE =
  "ai:portable-workspace-memory:delete-portable";
export const AI_PORTABLE_WORKSPACE_MEMORY_ENABLE_PREVIEW =
  "ai:portable-workspace-memory:enable:preview";
export const AI_PORTABLE_WORKSPACE_MEMORY_ENABLE =
  "ai:portable-workspace-memory:enable";
export const AI_PORTABLE_WORKSPACE_MEMORY_EXPORT_PREVIEW =
  "ai:portable-workspace-memory:export:preview";
export const AI_PORTABLE_WORKSPACE_MEMORY_EXPORT =
  "ai:portable-workspace-memory:export";
export const AI_PORTABLE_WORKSPACE_MEMORY_RESCAN =
  "ai:portable-workspace-memory:rescan";
export const AI_PORTABLE_WORKSPACE_MEMORY_DIAGNOSTICS_LIST =
  "ai:portable-workspace-memory:diagnostics:list";
export const AI_PORTABLE_WORKSPACE_MEMORY_CONFLICTS_LIST =
  "ai:portable-workspace-memory:conflicts:list";
export const AI_PORTABLE_WORKSPACE_MEMORY_CONFLICT_RESOLVE =
  "ai:portable-workspace-memory:conflict:resolve";
export const AI_PORTABLE_WORKSPACE_MEMORY_POLICY_UPDATE =
  "ai:portable-workspace-memory:policy:update";
export const AI_PORTABLE_WORKSPACE_MEMORY_PROMOTE =
  "ai:portable-workspace-memory:promote";
export const AI_PORTABLE_WORKSPACE_MEMORY_PRIVATIZE =
  "ai:portable-workspace-memory:privatize";
export const AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_APPROVE =
  "ai:portable-workspace-memory:review:approve";
export const AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_REJECT =
  "ai:portable-workspace-memory:review:reject";
export const AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_LIST =
  "ai:portable-workspace-memory:review:list";
export const AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_APPROVE_DELETION =
  "ai:portable-workspace-memory:review:approve-deletion";
export const AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_REJECT_DELETION =
  "ai:portable-workspace-memory:review:reject-deletion";
export const AI_PORTABLE_WORKSPACE_MEMORY_REVEAL_FILE =
  "ai:portable-workspace-memory:reveal-file";
export const AI_PORTABLE_WORKSPACE_MEMORY_GIT_STATUS =
  "ai:portable-workspace-memory:git-status";
export const AI_PORTABLE_WORKSPACE_MEMORY_GET_STATE =
  "ai:portable-workspace-memory:get-state";
export const AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_PREVIEW =
  "ai:portable-workspace-memory:bridge:preview";
export const AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_APPLY =
  "ai:portable-workspace-memory:bridge:apply";
export const AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_REMOVE =
  "ai:portable-workspace-memory:bridge:remove";
export const AI_PORTABLE_WORKSPACE_MEMORY_IDENTITY_REGENERATE =
  "ai:portable-workspace-memory:identity:regenerate";
// Renderer push event (main → renderer): one summary per reconciliation.
export const AI_PORTABLE_WORKSPACE_MEMORY_CHANGED =
  "ai:portable-workspace-memory:changed";

// Workspace Management Channels
export const AI_WORKSPACE_SET = "ai-workspace:set";
export const AI_WORKSPACE_GET = "ai-workspace:get";
export const AI_WORKSPACE_APPROVE = "ai-workspace:approve";
export const AI_WORKSPACE_REVOKE = "ai-workspace:revoke";
export const AI_WORKSPACE_LIST = "ai-workspace:list";

// Workspace Memory (durable, workspace-scoped memory)
export const AI_WORKSPACE_MEMORY_LIST = "ai:workspace-memory:list";
export const AI_WORKSPACE_MEMORY_CREATE = "ai:workspace-memory:create";
export const AI_WORKSPACE_MEMORY_UPDATE = "ai:workspace-memory:update";
export const AI_WORKSPACE_MEMORY_ARCHIVE = "ai:workspace-memory:archive";
export const AI_WORKSPACE_MEMORY_DELETE = "ai:workspace-memory:delete";
export const AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM =
  "ai:workspace-memory:auto-dream:run";
export const AI_WORKSPACE_MEMORY_AUTO_DREAM_STATUS =
  "ai:workspace-memory:auto-dream:status";

// Dialog Channels
export const DIALOG_PICK_FOLDER = "dialog:pick-folder";

// Local AI Runtime (downloadable first-party runtimes). These are local
// component-management channels (not hosted AI), so handlers use
// registerValidatedHandler, not the AI-enabled gate.
export const LOCAL_AI_RUNTIME_LIST = "local-ai-runtime:list";
export const LOCAL_AI_RUNTIME_STATUS = "local-ai-runtime:status";
export const LOCAL_AI_RUNTIME_PREPARE_INSTALL =
  "local-ai-runtime:prepare-install";
export const LOCAL_AI_RUNTIME_INSTALL = "local-ai-runtime:install";
export const LOCAL_AI_RUNTIME_CANCEL_INSTALL =
  "local-ai-runtime:cancel-install";
export const LOCAL_AI_RUNTIME_CHECK_UPDATE = "local-ai-runtime:check-update";
export const LOCAL_AI_RUNTIME_REPAIR = "local-ai-runtime:repair";
export const LOCAL_AI_RUNTIME_REMOVE = "local-ai-runtime:remove";
export const LOCAL_AI_RUNTIME_PROGRESS = "local-ai-runtime:progress";

// Hooks system — Phase 4 management UI channels.
export const HOOKS_LIST = "hooks:list";
export const HOOKS_CREATE = "hooks:create";
export const HOOKS_UPDATE = "hooks:update";
export const HOOKS_DELETE = "hooks:delete";
export const HOOKS_SET_ENABLED = "hooks:setEnabled";
export const HOOKS_GET_GLOBAL_ENABLE = "hooks:getGlobalEnable";
export const HOOKS_SET_GLOBAL_ENABLE = "hooks:setGlobalEnable";
export const HOOKS_LIST_AUDIT = "hooks:listAudit";

// Diagnostics Channels
export const DIAGNOSTICS_RENDERER_ERROR = "diagnostics:renderer-error";
export const DIAGNOSTICS_EXPORT_REPORT = "diagnostics:export-report";
export const DIAGNOSTICS_UPLOAD_REPORT = "diagnostics:upload-report";
export const DIAGNOSTICS_OPEN_FOLDER = "diagnostics:open-folder";
export const DIAGNOSTICS_GET_STATUS = "diagnostics:get-status";
export const DIAGNOSTICS_SET_DEBUG = "diagnostics:set-debug";
export const DIAGNOSTICS_CLEAR_LOCAL = "diagnostics:clear-local";
export const DIAGNOSTICS_LIST_CRASHES = "diagnostics:list-crashes";

// ======== AI Content Reporting ========
// Safety/support reporting for AI-generated output (Microsoft Store Policy
// 11.16). NOT AI-gated — must remain available when USER_AI_ENABLED is false.
export const AI_CONTENT_REPORT_CREATE = "ai:content:report:create";
