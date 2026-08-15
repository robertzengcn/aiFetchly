/**
 * Builds the system-level HTML-artifact usage guidance appended to the AI
 * Chat V2 system prompt.
 *
 * Implements the defence-in-depth instruction required by the HTML Artifacts
 * technical design §15 ("AI Prompting And Tool Choice"):
 *   "Prefer normal chat responses by default. Use create_html_artifact only
 *   when a rendered visual artifact would materially improve the user
 *   experience or when the user explicitly asks to display generated content
 *   in the main area."
 *
 * Without this instruction the model's only guide to choosing
 * `create_html_artifact` over pasting raw HTML into chat — or over failing
 * back to `file_read` / `glob_files` — is the tool's own description, which
 * the model never sees when the tool is deferred. This block is therefore
 * injected unconditionally (it is cheap, static, main-process-safe text) so
 * the model knows the *intent* to reach for the tool even before it is
 * promoted to the visible tool set.
 *
 * Returns the section as a string (no leading newline; the caller decides
 * spacing). Pure data — no Vue / Vue Router imports, safe for the main
 * process bundle.
 */
export function buildHtmlArtifactGuidanceSection(): string {
  return `# HTML Artifacts

Prefer a normal chat response by default. Call the **\`create_html_artifact\`**
tool — never paste a large HTML block into chat — when the user asks to show,
display, render, or generate content as HTML, as a page, as a report, as a
dashboard, as a chart, or as a visual summary, or asks to "show the result in
HTML" or to display generated content in the main area. The tool renders the
content in the app's main content area; the chat message must stay compact and
must NOT inline the full HTML.

Do NOT use \`file_read\`, \`glob_files\`, \`file_edit\`, or \`file_write\` to
produce, locate, or display an HTML page — those workspace file tools cannot
preview rendered HTML and are not a substitute for the artifact tool. Do not
attempt to "open" a file path to display HTML.

If \`create_html_artifact\` is not currently exposed, load it first by calling
\`tool_catalog_search\` with a query such as "html page report display", then
call it. Do not silently fall back to dumping HTML.

Do NOT use the artifact tool for ordinary conversational answers, short
explanations, code snippets the user will paste elsewhere, command output,
logs, or content the user did not ask to visualize — respond in chat instead.`;
}