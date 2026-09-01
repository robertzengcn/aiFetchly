/**
 * Builds the system-level "Built-in Tool Capabilities" table appended to the
 * AI Chat V2 system prompt.
 *
 * WHY THIS EXISTS
 * Many built-in tools are `contextual` or `deferred` (see
 * {@link ToolLoadPolicyService}): they are hidden from the model until the
 * user's message matches an intent regex, or until the model explicitly loads
 * them via `tool_catalog_search`. When the model cannot see a specialized tool,
 * it has historically fallen back to the always-loaded `file_read` / `glob_files`
 * (or dumped output into chat) — exactly the failure that hit
 * `create_html_artifact` ("show result in html" → raw HTML pasted in chat).
 *
 * This block is the defence-in-depth required by the HTML-artifacts technical
 * design §15, generalized to EVERY contextual/deferred built-in capability,
 * while respecting the tool-list-management design §20's preference for a
 * single category-level hint (not one verbose block per family) to keep the
 * always-injected system-prompt budget small (~350 tokens, not ~2100).
 *
 * WHAT IT TELLS THE MODEL
 * A compact "capability → trigger phrasing → tool names → search query" map.
 * The model maps a natural-language request to a capability, then either calls
 * the named tool (if exposed) or calls `tool_catalog_search` with the suggested
 * query to load it (if not). It also tells the model NOT to substitute
 * `file_read` / `glob_files` for a specialized tool, and that some tools (e.g.
 * email reply) are NOT auto-promoted by intent and MUST be loaded via search.
 *
 * Constraint: pure data, no Vue / Vue Router imports — safe for the main
 * process bundle (same contract as {@link ChatModePromptSection}).
 */
export function buildBuiltInToolCapabilitiesSection(): string {
  return `# Built-in Tool Capabilities

Most built-in tools are deferred — they are NOT in your tool list until you
load them. When a request matches one of the capabilities below:

1. If the named tool is already exposed, call it directly.
2. Otherwise call \`tool_catalog_search\` with the suggested query, then call
   the loaded tool on the next round. Do NOT silently fall back to
   \`file_read\` / \`glob_files\` / \`shell_execute\` to substitute for a
   specialized tool, and do NOT paste the rendered output into chat as a
   substitute (an HTML page/report, an edited image, etc. must be produced via
   its tool so the app displays it correctly).

| Capability (user phrasing) |原生工具 | search query |
|---|---|---|
| Show/render/display data as HTML, a page, a report, a dashboard, a chart, a visual summary; "show result in html" | \`create_html_artifact\` | \`html page report display\` |
| Create/overwrite/edit a workspace file; **export/download/convert/save data to a csv/xlsx/spreadsheet/json/file** — use \`file_write\` with the full content (NOT a shell echo, NOT row-by-row appends), \`file_edit\` for exact string replace | \`file_write\`, \`file_edit\` | \`file create write export csv\` |
| Edit/analyze/compare/change background of LOCAL workspace images — NOT via shell/Pillow | \`attach_local_images\` (1-3 images), \`process_artifact_batch\` (same edit to many) | \`image edit attach\` |
| Check email inbox / unread / new / received mail, read an inbound message (IMAP receive only — an empty inbox list does NOT mean sending is unavailable) | \`list_email_inboxes\`, \`fetch_unread_emails\`, \`get_email_message\`, \`mark_email_processed\` | \`email inbox unread\` |
| Send NEW outbound/marketing emails to contacts/customers (NOT inbox replies). Use SMTP senders from \`list_email_services\` + \`start_email_send_task\`. For unique content per recipient, call \`start_email_send_task\` once per address. Do NOT use \`send_email_reply\` or \`list_email_inboxes\` for this. | \`list_email_services\`, \`list_email_templates\`, \`start_email_send_task\` | \`send marketing email outbound\` |
| Draft or send an INBOUND email REPLY only (these are NOT auto-promoted — always load via search). Not for new marketing/outbound mail. | \`create_email_reply_draft\`, \`send_email_reply\` | \`email reply send draft\` |
| Automation schedule / cron / run later / recurring task | \`list_schedules\`, \`get_schedule_details\`, \`list_schedule_executions\`, \`create_schedule\`, \`update_schedule\`, \`delete_schedule\`, \`pause_schedule\`, \`resume_schedule\`, \`run_schedule_now\` | \`schedule cron automation\` |
| Import/list/delete knowledge-library documents; import a webpage/url/docs into the knowledge base | \`knowledge_library_list_documents\`, \`knowledge_library_import_attachment\`, \`knowledge_library_import_website\`, \`knowledge_library_delete_document\` | \`knowledge library import\` |
| Browse/scrape search-engine result URLs; extract contacts or read page content by URL | \`scrape_urls_from_search_engine\`, \`extract_contact_info\`, \`read_url_content\` | \`scrape search extract contact\` |
| Run a local shell command (needs confirmation). shell_execute is for executing commands the user asked for — do NOT use it as a substitute for file_write to create/export a data file (csv/xlsx/json) via echo/redirect, do NOT use it for image edits (use attach_local_images), and do NOT use it to read/write workspace files | \`shell_execute\` | \`shell command run\` |

If a capability you need is not listed and not exposed, search the catalog by
keyword with \`tool_catalog_search\`. Prefer normal chat responses for simple
questions; use these tools only when the user's request needs the capability.`;
}
