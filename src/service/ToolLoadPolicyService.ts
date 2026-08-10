/**
 * ToolLoadPolicyService — classifies each catalog entry as `always`,
 * `deferred`, or `contextual` using deterministic rules (FR-2, design §10).
 *
 * Policy is derived purely from tool name, detected source, and the runtime
 * context. It NEVER inspects tool arguments (arguments do not exist before
 * tool selection).
 *
 *   always      -> full schema sent every round
 *   deferred    -> discoverable via tool_catalog_search; schema hidden until
 *                  discovered
 *   contextual  -> exposed when forced by mode/context (plan mode, user mention)
 */

import type { OpenAITool } from "@/api/aiChatApi";
import { TOOL_CATALOG_SEARCH_TOOL_NAME } from "@/config/toolCatalogConfig";
import type {
  ToolCatalogRuntimeContext,
  ToolCatalogSource,
  ToolLoadPolicy,
} from "@/entityTypes/toolCatalogTypes";
import { isPlanToolName } from "@/service/PlanModeToolPolicy";
import { isEnterPlanModeToolName } from "@/service/EnterPlanModeTool";

/**
 * Built-in tools that are broadly useful for general assistance and small
 * enough to always include in the first payload (design §10). Everything else
 * built-in is specialized (scraping/marketing/email/scheduling) and deferred.
 */
const ALWAYS_LOADED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "file_read",
  "glob_files",
  "grep_files",
  "check_tool_job_status",
  "check_shell_status",
  "read_attachment_content",
  "knowledge_library_search",
  "run_subagent",
]);

const CONTEXTUAL_SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "shell_execute",
]);

const CONTEXTUAL_FILE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "file_write",
]);

const CONTEXTUAL_FILE_EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "file_edit",
]);

const CONTEXTUAL_KNOWLEDGE_LIBRARY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "knowledge_library_list_documents",
  "knowledge_library_import_attachment",
  "knowledge_library_import_website",
  "knowledge_library_delete_document",
]);

const CONTEXTUAL_SCHEDULE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_schedules",
  "get_schedule_details",
  "list_schedule_executions",
  "create_schedule",
  "update_schedule",
  "delete_schedule",
  "pause_schedule",
  "resume_schedule",
  "run_schedule_now",
]);

const CONTEXTUAL_HTML_ARTIFACT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "create_html_artifact",
]);

const CONTEXTUAL_IMAGE_ATTACH_TOOL_NAMES: ReadonlySet<string> = new Set([
  "attach_local_images",
  "process_artifact_batch",
]);

/**
 * Inbound mailbox read tools. Promoted when the user asks to check inbox /
 * unread / new mail so the model does not claim email tools are missing
 * while they sit deferred behind tool_catalog_search.
 */
const CONTEXTUAL_EMAIL_INBOX_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_email_inboxes",
  "fetch_unread_emails",
  "get_email_message",
  "mark_email_processed",
]);

const SHELL_INTENT_RE =
  /\b(shell|terminal|bash|powershell|cmd|command|execute|run|rm|unlink)\b|(?:\b(delete|remove)\b.*(?:\b(file|folder|directory|path)\b|[./~]|\.[A-Za-z0-9]{1,8}\b))/i;

const FILE_WRITE_INTENT_RE =
  /\b(create|write|save|overwrite|generate|make)\b.*(?:\b(file|document)\b|[./~]|\.[A-Za-z0-9]{1,8}\b)|(?:\b(file|document)\b.*\b(create|write|save|overwrite|generate|make)\b)|\b(update|replace|change)\b.*\bfile\b.*\bcontent\b/i;

const FILE_EDIT_INTENT_RE =
  /\b(edit|modify|replace|patch|update|change|fix)\b.*(?:\b(file|document|path)\b|[./~]|\.[A-Za-z0-9]{1,8}\b)/i;

const KNOWLEDGE_LIBRARY_INTENT_RE =
  /\b(knowledge[- ]?library|knowledge base|rag|library documents?|documents? in (?:the )?library)\b/i;

/**
 * Website-import phrasing that should surface the import_website tool even when
 * the user does not say "knowledge library" verbatim. Matches phrases like
 * "import this webpage into knowledge", "save this url to the library",
 * "crawl the docs into knowledge", "remember this website".
 */
const WEBSITE_IMPORT_INTENT_RE =
  /\b(?:import|save|add|remember|crawl|scrape|index|store)\b[^.]{0,60}?\b(?:webpage|website|web page|url|docs?|documentation|faq|pricing|policy|policies|support page|page)\b[^.]{0,60}?\b(?:knowledge|library|rag|knowledge base)\b/i;

const SCHEDULE_INTENT_RE =
  /\b(schedule|scheduled|scheduler|cron|run .*\b(?:later|daily|weekly|monthly)|automation schedule)\b/i;

const HTML_ARTIFACT_INTENT_RE =
  /\b(html artifact|artifact|dashboard|chart|visual report|interactive report|formatted document|landing[- ]page preview|comparison table)\b/i;

/**
 * Natural-language local-image attach / analyze / edit intent.
 * Surfaces `attach_local_images` so the model does not fall back to
 * shell/Pillow for workspace image edits (PRD UC1).
 * `backgroun\w*` tolerates common typos such as "backgroud".
 */
const IMAGE_ATTACH_INTENT_RE =
  /\b(attach|analyze|compare|edit|modify|update|change|fix|replace|remove)\b[^.]{0,100}?\b(images?|photos?|pictures?|jpe?g|png|webp|gif|background)\b|\b(images?|photos?|pictures?)\b[^.]{0,100}?\b(attach|analyze|compare|edit|background|white|transparent)\b|\b(make|change|set|update)\b[^.]{0,60}?\bbackgroun\w*\b/i;

/**
 * Natural-language inbound mailbox check intent.
 * Surfaces list/fetch/read inbox tools so "check my email / inbox / mailbox"
 * does not leave those tools deferred. Tolerates common typos such as
 * "emaibox". Avoids outbound marketing phrasing (bulk send, templates).
 */
const EMAIL_INBOX_INTENT_RE =
  /\b(inbox|inboxes|mailbox|mailboxes|emaibox)\b|\b(unread|new|received|inbound)\s+emails?\b|\bcheck(?:ing)?\b[^.]{0,60}?\b(emails?|mails?|inbox|mailbox|emaibox)\b|\b(emails?|mails?)\b[^.]{0,60}?\b(inbox|mailbox|emaibox|unread)\b/i;

/**
 * Short follow-ups that should inherit intent from recent prior user messages
 * (e.g. "continue" after an image-edit request).
 */
const CONTINUATION_MESSAGE_RE =
  /^(continue|yes|y|ok|okay|sure|go\s*on|go\s*ahead|retry|try\s*again|please\s*continue|do\s*it|proceed|keep\s*going)\.?$/i;

/** Source types that are always deferred by default. */
const DEFERRED_SOURCES: ReadonlySet<ToolCatalogSource> = new Set([
  "mcp",
  "plugin",
  "imported",
  "subagent",
]);

export interface ClassifyInput {
  readonly tool: OpenAITool;
  readonly source: ToolCatalogSource;
  readonly context: ToolCatalogRuntimeContext;
}

export class ToolLoadPolicyService {
  classify(input: ClassifyInput): ToolLoadPolicy {
    const name = input.tool.function.name;

    // 1. The discovery tool itself is always available when deferred mode is on.
    if (name === TOOL_CATALOG_SEARCH_TOOL_NAME) return "always";

    // 2. Plan-mode tools are mode-required.
    if (isPlanToolName(name)) {
      return input.context.isPlanMode ? "always" : "contextual";
    }
    if (isEnterPlanModeToolName(name)) return "contextual";

    // 3. Explicit always-loaded core helpers.
    if (ALWAYS_LOADED_TOOL_NAMES.has(name)) return "always";

    // 4. Explicitly blocked tools are never auto-exposed.
    if (input.context.blockedToolNames?.has(name)) return "deferred";

    // 5. Source-based deferral.
    if (DEFERRED_SOURCES.has(input.source)) return "deferred";

    // 6. Contextual promotion: user explicitly named this tool.
    if (
      this.messageMatchesIntent(input.context, (msg) =>
        this.isMentionedInMessage(name, msg)
      )
    ) {
      return "contextual";
    }

    // 7. Contextual promotion: shell execution is high-impact, so do not send
    // it for ordinary chat. Expose it when the user's current message clearly
    // asks for shell-like work such as `rm`, terminal/command execution, or
    // deleting a file. Existing shell permission prompts remain authoritative.
    if (
      CONTEXTUAL_SHELL_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasShellIntent(msg)
      )
    ) {
      return "contextual";
    }

    // 8. Contextual promotion: workspace write/edit tools are hidden for
    // ordinary chat, but should be present when the user plainly asks to
    // create or modify files. Confirmation still gates the actual mutation.
    if (
      CONTEXTUAL_FILE_WRITE_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasFileWriteIntent(msg)
      )
    ) {
      return "contextual";
    }
    if (
      CONTEXTUAL_FILE_EDIT_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasFileEditIntent(msg)
      )
    ) {
      return "contextual";
    }

    // 9. Contextual promotion for built-in capabilities that are otherwise
    // hard to discover from natural wording because their exact function names
    // are not user-visible.
    if (
      CONTEXTUAL_KNOWLEDGE_LIBRARY_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasKnowledgeLibraryIntent(msg)
      )
    ) {
      return "contextual";
    }
    if (
      CONTEXTUAL_SCHEDULE_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasScheduleIntent(msg)
      )
    ) {
      return "contextual";
    }
    if (
      CONTEXTUAL_HTML_ARTIFACT_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasHtmlArtifactIntent(msg)
      )
    ) {
      return "contextual";
    }
    if (
      CONTEXTUAL_IMAGE_ATTACH_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasImageAttachIntent(msg)
      )
    ) {
      return "contextual";
    }
    if (
      CONTEXTUAL_EMAIL_INBOX_TOOL_NAMES.has(name) &&
      this.messageMatchesIntent(input.context, (msg) =>
        this.hasEmailInboxIntent(msg)
      )
    ) {
      return "contextual";
    }

    // 10. Built-in default: specialized tools are deferred and discoverable.
    return "deferred";
  }

  /**
   * Intent texts to evaluate. Always includes the current user message. When
   * the current message is a short continuation ("continue", "yes", …), also
   * includes recent prior user messages so contextual tools stay promoted.
   */
  private intentMessages(context: ToolCatalogRuntimeContext): string[] {
    const current = context.currentUserMessage ?? "";
    const recent = context.recentUserMessages ?? [];
    if (CONTINUATION_MESSAGE_RE.test(current.trim()) && recent.length > 0) {
      return [current, ...recent];
    }
    return [current];
  }

  private messageMatchesIntent(
    context: ToolCatalogRuntimeContext,
    tester: (message: string) => boolean
  ): boolean {
    return this.intentMessages(context).some((msg) => tester(msg));
  }

  private isMentionedInMessage(name: string, message: string): boolean {
    if (!message || !name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    return re.test(message);
  }

  private hasShellIntent(message: string): boolean {
    return SHELL_INTENT_RE.test(message);
  }

  private hasFileWriteIntent(message: string): boolean {
    return FILE_WRITE_INTENT_RE.test(message);
  }

  private hasFileEditIntent(message: string): boolean {
    return FILE_EDIT_INTENT_RE.test(message);
  }

  private hasKnowledgeLibraryIntent(message: string): boolean {
    return (
      KNOWLEDGE_LIBRARY_INTENT_RE.test(message) ||
      WEBSITE_IMPORT_INTENT_RE.test(message)
    );
  }

  private hasScheduleIntent(message: string): boolean {
    return SCHEDULE_INTENT_RE.test(message);
  }

  private hasHtmlArtifactIntent(message: string): boolean {
    return HTML_ARTIFACT_INTENT_RE.test(message);
  }

  private hasImageAttachIntent(message: string): boolean {
    return IMAGE_ATTACH_INTENT_RE.test(message);
  }

  private hasEmailInboxIntent(message: string): boolean {
    return EMAIL_INBOX_INTENT_RE.test(message);
  }
}
