/**
 * C04/M-FR-13: the OS-window title marker script. The marker is applied
 * to document.title ONLY (never page content) and is IDEMPOTENT — the
 * script strips any existing "[AI] "/"[You] " prefix before applying the
 * wanted one, so document reloads never grow "[AI] [AI] ..." and a
 * takeover actually renames the window to the user marker.
 */
export function windowTitleMarkerScript(prefix: string): string {
  const escaped = JSON.stringify(`${prefix} `);
  return (
    "(() => { try { " +
    "const raw = document.title.replace(/^\\[(AI|You)\\] /, '');" +
    `document.title = ${escaped} + raw;` +
    " } catch { /* about:blank */ } })()"
  );
}
