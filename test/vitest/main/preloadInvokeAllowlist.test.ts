"use strict";
/**
 * Regression guard for the preload `invoke` channel allowlist.
 *
 * The preload's `invoke` exposes `window.api.invoke`, but it forwards to
 * `ipcRenderer.invoke` ONLY for channels listed in its inline `validChannels`
 * array — every other channel silently returns `undefined`. A renderer call on
 * a non-allowlisted channel therefore never reaches its main-process handler.
 *
 * This happened to `RAG_IMPORT_WEBSITE`: the channel was registered in
 * `rag-ipc.ts`, called by the renderer (`importWebsite` → `windowInvoke`), and
 * had a handler (`handleRagImportWebsite`), but was missing from the preload
 * allowlist — so clicking Import in `WebsiteImportDialog.vue` no-op'd. These
 * tests pin the invariant for the channels the Knowledge Library UI depends on.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const PRELOAD_SRC = readFileSync("src/preload.ts", "utf8");

/**
 * Slice of preload.ts covering the `invoke` method body. `invoke` is the last
 * method exposed on `window.api` (followed only by the closing `});` of
 * `contextBridge.exposeInMainWorld`), so the substring from its signature to
 * EOF is exactly its `validChannels` whitelist.
 */
function preloadInvokeWhitelistSource(): string {
  const marker = "invoke: (channel: string, data?: unknown) =>";
  const idx = PRELOAD_SRC.indexOf(marker);
  expect(idx).toBeGreaterThan(-1); // sanity: the invoke marker still exists
  return PRELOAD_SRC.slice(idx);
}

describe("preload invoke allowlist", () => {
  it("allows RAG_IMPORT_WEBSITE (Knowledge Library website import)", () => {
    // Referenced by identifier in preload.ts (not by its string value), so the
    // assertion checks for the identifier token.
    expect(preloadInvokeWhitelistSource()).toContain("RAG_IMPORT_WEBSITE");
  });
});
