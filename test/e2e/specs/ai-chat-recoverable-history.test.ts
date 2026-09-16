/**
 * Recoverable-history E2E specs (PRD AC-01/AC-17/AC-18/AC-20, design §17.2).
 *
 * Drives the real renderer → preload → IPC → module → SQLite path against the
 * source-built E2E main bundle and the FakeOpenAI loopback server. State is
 * isolated per test via a unique temp root; the four recoverable-history
 * rollout flags (technical-design §18) are enabled through the state manifest
 * `tokenOverrides` so the flag-gated archive/compaction/UI paths are active.
 *
 * Covered acceptance criteria:
 *
 *   AC-01 — Put exact wording early in a conversation; compact; restart; the
 *           original wording is still retrievable from the archive (§17.2 line
 *           618: "compact, restart, exact recovery"). Proven through the REAL
 *           history-search IPC against the same isolated root across a
 *           controlled relaunch.
 *   AC-17 — Open older messages without selecting them: the UI shows history
 *           but the model context does not grow. Proven by asserting the
 *           streamed chat request's message count is bounded after browsing.
 *   AC-18 — Select a passage for the next reply: the correct stored passage is
 *           included once, within budget, with provenance. Proven via persisted
 *           `metadata.historySelections` references (provenance only — never
 *           the passage text) AND chip-clear-on-`start` UI behavior. The fake
 *           provider's redacted request log never records content.
 *   AC-20 — Disable AI and browse history: local history remains readable and
 *           no unauthorized AI call occurs. Proven by relaunching the SAME root
 *           in the hosted-disabled state and asserting history-search returns
 *           records while the fake provider received zero requests.
 *
 * Adjacent coverage:
 *
 *   §17.2 deletion — clear the conversation (tombstone cascade) and assert
 *           the tombstoned shapes: read → SOURCE_UNAVAILABLE/empty; search →
 *           HISTORY_NO_MATCH with scanComplete:true/indexComplete:false;
 *           resolve-selections → HISTORY_SCOPE_INVALID.
 *
 * Relative imports only — the E2E test layer is deliberately decoupled from
 * `src/` (design §9.3).
 */

import { test, expect } from "@playwright/test";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";

/**
 * The four recoverable-history rollout flags (technical-design §18) enabled for
 * every scenario below. The bootstrap validates that `tokenOverrides` keys are
 * restricted to exactly these flag names and values to "true"/"false".
 */
const RECOVERABLE_FLAGS_ON: Readonly<Record<string, string>> = {
  ai_chat_archive_reads_flag: "true",
  ai_chat_history_tools_flag: "true",
  ai_chat_new_compaction_flag: "true",
  ai_chat_history_ui_flag: "true",
};

function composer(app: LaunchedApp): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}

/**
 * Close the history drawer so its Vuetify scrim stops intercepting pointer
 * events over the composer. The drawer's toggle button only opens
 * (`showHistoryDrawer = true`), and Playwright clicks on the close icon / scrim
 * don't reliably trigger Vuetify's listeners in Electron, so we set the
 * parent's `showHistoryDrawer` ref to `false` directly through the Vue
 * component proxy.
 *
 * A Vuetify `temporary` drawer never sets `display:none` when closed — it
 * slides off-screen via `transform` and drops the `--active` class. So we
 * assert on the `--active` class being gone (not `toBeVisible`), which also
 * guarantees the scrim overlay has been removed.
 */
async function closeHistoryDrawer(app: LaunchedApp): Promise<void> {
  const drawer = app.mainWindow.getByTestId("ai-history-drawer");
  if (!(await drawer.isVisible().catch(() => false))) return;
  await app.mainWindow.evaluate(() => {
    const nav = document.querySelector('[data-testid="ai-history-drawer"]');
    if (!nav) return;
    type VueComp = {
      setupState?: Record<string, unknown>;
      parent?: VueComp | null;
    };
    type VueEl = HTMLElement & { __vueParentComponent?: VueComp | null };
    let comp = (nav as VueEl).__vueParentComponent;
    let depth = 0;
    while (comp && depth < 20) {
      const state = comp.setupState;
      if (state && "showHistoryDrawer" in state) {
        (state as Record<string, unknown>).showHistoryDrawer = false;
        break;
      }
      comp = comp.parent ?? undefined;
      depth++;
    }
  });
  // The --active class is removed once the drawer's v-model flips to false;
  // the scrim overlay is removed at the same time, so the composer is
  // interactive again.
  await expect(drawer).not.toHaveClass(/v-navigation-drawer--active/, {
    timeout: 10_000,
  });
}

/** Send a message and wait for the streamed reply to fully complete. */
async function sendAndWait(app: LaunchedApp, text: string): Promise<void> {
  await composer(app).fill(text);
  await app.mainWindow.getByTestId("ai-chat-send").click();
  // Wait for the streamed response to complete so the turn + message persist
  // and the chatIsRunning guard clears (the send button re-appears).
  await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
    STREAM_TEXT_FINAL,
    { timeout: 30_000 }
  );
  await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Invoke a history/compaction IPC channel in-page via the real preload
 * `window.api.invoke` bridge. Returns the full CommonMessage envelope
 * ({ status, msg, data }) so callers can assert status + errorCode.
 */
/**
 * The nested history-browse envelope. The IPC handlers wrap the retrieval
 * result via `historyOk(result, errorCode)` → `ok({ data: result, errorCode })`,
 * so the payload reads `{ status, msg, data: { data: <result>, errorCode } }`.
 * Plain `ok(channel)` envelopes (`conversations`, `history`) carry their data
 * directly on `data` with no inner envelope.
 */
interface BrowseEnvelope<R> {
  data: R | null;
  errorCode?: string;
}

async function invokeChannel(
  app: LaunchedApp,
  channel: string,
  payload: unknown
): Promise<{
  status: boolean;
  msg: string;
  data: unknown;
}> {
  return app.mainWindow.evaluate(
    async ([ch, body]) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              channel: string,
              data?: unknown
            ) => Promise<
              { status: boolean; msg: string; data: unknown } | undefined
            >;
          };
        }
      ).api;
      const resp = await api.invoke(
        ch,
        typeof body === "string" ? body : JSON.stringify(body)
      );
      return resp ?? { status: false, msg: "no response", data: null };
    },
    [channel, payload] as const
  );
}

/**
 * Invoke a history browse channel and return its UNWRAPPED browse envelope
 * (`resp.data` is `{data: result, errorCode}` — this peels that one level so
 * callers read `records`/`scanComplete`/`indexComplete` directly).
 */
async function invokeBrowse<R>(
  app: LaunchedApp,
  channel: string,
  payload: unknown
): Promise<{
  status: boolean;
  result: R | null;
  errorCode: string | undefined;
}> {
  const resp = await invokeChannel(app, channel, payload);
  const envelope = (resp.data ?? null) as BrowseEnvelope<R> | null;
  return {
    status: resp.status,
    result: envelope?.data ?? null,
    errorCode: envelope?.errorCode,
  };
}

/** The list of conversation summaries from the real conversations IPC. */
async function listConversations(
  app: LaunchedApp
): Promise<ReadonlyArray<{ conversationId: string; title?: string }>> {
  const resp = await invokeChannel(app, "ai-chat-v2:conversations", {});
  if (!resp.status) return [];
  const data = resp.data as
    | ReadonlyArray<{ conversationId: string; title?: string }>
    | undefined;
  return data ?? [];
}

/** Look up the conversationId of the first (most recent) conversation. */
async function firstConversationId(app: LaunchedApp): Promise<string | null> {
  const convs = await listConversations(app);
  return convs[0]?.conversationId ?? null;
}

// ---------------------------------------------------------------------------
// AC-01: compact → restart → exact recovery from the archive.
// ---------------------------------------------------------------------------

test("AC-01: archived wording survives a compaction and a controlled restart", async (_fixtures: unknown, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  try {
    // --- Session 1: one turn with a unique recoverable marker. ---
    await fakeAi.setScenario("stream-text");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: RECOVERABLE_FLAGS_ON,
    });

    const marker = `ac01-recover-${Date.now()}`;
    const app1 = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app1);
      // Two turns: the marker lands in turn 1 (below the packer's high-water
      // mark, which is the end of the LAST complete turn), so compaction can
      // pack it; turn 2 pushes the high-water past the marker.
      await sendAndWait(app1, marker);
      await sendAndWait(app1, `ac01-followup-${Date.now()}`);

      // Compact via IPC (the UI compact button has no stable testid; it only
      // appears at ≥80% context fill). The durable coordinator packs + validates
      // the first section and publishes a generation.
      const conversationId = await firstConversationId(app1);
      expect(conversationId).toBeTruthy();

      // The append coupler advances the high-water mark fire-and-forget after
      // each turn. Poll history-search until indexComplete === true so the
      // high-water reflects the true end of the last complete turn — otherwise
      // the packer finds no source strictly before it (sectionsPacked === 0)
      // or the state isn't ensured yet (CONTEXT_REJECTED).
      await expect
        .poll(
          async () => {
            const b = await invokeBrowse<{ indexComplete?: boolean }>(
              app1,
              "ai-chat-v2:history-search",
              { conversationId, query: marker, limit: 1 }
            );
            return b.result?.indexComplete === true;
          },
          { timeout: 30_000, intervals: [1_000] }
        )
        .toBe(true);

      const compactResp = await invokeChannel(
        app1,
        "ai-chat-v2:compact-conversation",
        { conversationId }
      );
      expect(compactResp.status).toBe(true);
      const summary = compactResp.data as {
        sourceMessageCount?: number;
      } | null;
      expect(summary?.sourceMessageCount ?? 0).toBeGreaterThanOrEqual(1);
      await closeApp(app1);
    } catch (err) {
      await closeApp(app1);
      throw err;
    }

    // --- Session 2: same root + flags; history-search must find the marker. ---
    await fakeAi.reset();
    await fakeAi.setScenario("stream-text");
    const app2 = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app2);
      const conversationId = await firstConversationId(app2);
      expect(conversationId).toBeTruthy();

      const browse = await invokeBrowse<{
        records?: ReadonlyArray<{ text?: string; sourceId?: string }>;
        scanComplete?: boolean;
      }>(app2, "ai-chat-v2:history-search", {
        conversationId,
        query: marker,
        limit: 5,
      });
      expect(browse.status).toBe(true);
      const records = browse.result?.records ?? [];
      expect(records.length).toBeGreaterThanOrEqual(1);
      // Exact recovery: the original marker wording is present in the record.
      expect(JSON.stringify(records)).toContain(marker);
      await closeApp(app2);
    } catch (err) {
      await closeApp(app2);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});

// ---------------------------------------------------------------------------
// AC-17: browse without selection → model context does not grow.
// ---------------------------------------------------------------------------

test("AC-17: browsing older history without selecting does not grow the model context", async (_fixtures: unknown, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  try {
    await fakeAi.setScenario("stream-text");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: RECOVERABLE_FLAGS_ON,
    });

    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);
      // Establish a conversation + history by completing two turns.
      await sendAndWait(app, `ac17-first-${Date.now()}`);
      await sendAndWait(app, `ac17-second-${Date.now()}`);

      // Open the history drawer and search (browse) WITHOUT selecting anything.
      await app.mainWindow.getByTestId("ai-history-drawer-toggle").click();
      await expect(app.mainWindow.getByTestId("ai-history-drawer")).toBeVisible(
        { timeout: 15_000 }
      );
      await app.mainWindow
        .getByTestId("ai-history-search-input")
        .locator("input")
        .first()
        .fill("ac17");
      await app.mainWindow.getByTestId("ai-history-search-button").click();
      // The drawer shows results — history is visible.
      await expect(
        app.mainWindow.getByTestId("ai-history-drawer")
      ).toContainText("ac17", { timeout: 15_000 });

      // Reset the request log so the next streamed turn is the only sample.
      await fakeAi.reset();
      await fakeAi.setScenario("stream-text");
      // Close the history drawer so its Vuetify scrim stops overlaying the
      // composer, then send a plain follow-up with NO selections (the chips
      // panel is absent — nothing was selected).
      await closeHistoryDrawer(app);
      await sendAndWait(app, `ac17-followup-${Date.now()}`);

      // The streamed chat request (stream:true) must be the ONLY network
      // request — browsing added no model context. Filter out the
      // non-streaming (stream:false) compaction/summarize path, which is a
      // different channel and never carries user browsing content.
      const requests = await fakeAi.getRequests();
      const streamed = requests.filter((r) => r.stream === true);
      expect(streamed.length).toBe(1);
      // The message count is bounded: just the small follow-up turn, not the
      // browsed history (the archive browsing never enters the model request).
      const messageCount = streamed[0].messageCount;
      expect(messageCount).toBeLessThan(20);
      await closeApp(app);
    } catch (err) {
      await closeApp(app);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});

// ---------------------------------------------------------------------------
// AC-18: selection transport — provenance persisted, chips clear on `start`,
// and the passage text never reaches the redacted request log.
// ---------------------------------------------------------------------------

test("AC-18: a selected passage is persisted as references only and clears its chip on acceptance", async (_fixtures: unknown, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  try {
    await fakeAi.setScenario("stream-text");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: RECOVERABLE_FLAGS_ON,
    });

    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);
      const passageMarker = `ac18-passage-${Date.now()}`;
      // Complete a turn whose assistant reply carries the unique passage text.
      await sendAndWait(app, `ac18-set: ${passageMarker}`);

      // Open the history drawer, search for the passage, and select it.
      await app.mainWindow.getByTestId("ai-history-drawer-toggle").click();
      await expect(app.mainWindow.getByTestId("ai-history-drawer")).toBeVisible(
        { timeout: 15_000 }
      );
      await app.mainWindow
        .getByTestId("ai-history-search-input")
        .locator("input")
        .first()
        .fill(passageMarker);
      await app.mainWindow.getByTestId("ai-history-search-button").click();
      // The "Select passage" button is present on the matching record.
      const selectBtn = app.mainWindow.getByTestId("ai-history-select-passage");
      await expect(selectBtn.first()).toBeVisible({ timeout: 15_000 });
      await selectBtn.first().click();

      // A chip must now render in the selected-context panel.
      const chipPanel = app.mainWindow.getByTestId("ai-selected-context");
      await expect(chipPanel).toBeVisible({ timeout: 15_000 });
      await expect(chipPanel).toContainText(passageMarker.slice(0, 8));

      // Close the history drawer before sending the follow-up that transports
      // the selection. The drawer's Vuetify scrim intercepts composer pointer
      // events while it stays open, and Playwright clicks do not reliably
      // trigger the drawer's Vue `@click="emitClose"` handler in this Electron
      // build — so close it via the Vue reactivity proxy instead (see
      // closeHistoryDrawer) and send through the normal path.
      await closeHistoryDrawer(app);
      await sendAndWait(app, `ac18-followup-${Date.now()}`);
      // The streamed reply completes — the `start` event has fired by then,
      // which clears the accepted chip (§13.3: accepted selections are
      // consumed into the turn).
      await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
        STREAM_TEXT_FINAL,
        { timeout: 30_000 }
      );
      await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
        timeout: 30_000,
      });
      // The accepted chip cleared (consumed into the turn).
      await expect(
        app.mainWindow.getByTestId("ai-selected-context")
      ).not.toBeVisible({ timeout: 15_000 });

      // --- Provenance persisted (references only, never the text). ---
      const conversationId = await firstConversationId(app);
      expect(conversationId).toBeTruthy();
      const histResp = await invokeChannel(app, "ai-chat-v2:history", {
        conversationId,
      });
      expect(histResp.status).toBe(true);
      const histData = histResp.data as {
        messages?: ReadonlyArray<{
          metadata?: {
            historySelections?: ReadonlyArray<{
              sourceId?: string;
              messageId?: string;
              role?: string;
              exact?: boolean;
            }>;
          };
        }>;
      } | null;
      const allMessages = histData?.messages ?? [];
      const withSelections = allMessages.filter(
        (m) => m.metadata?.historySelections?.length
      );
      expect(withSelections.length).toBeGreaterThanOrEqual(1);
      const selections = withSelections[0].metadata?.historySelections ?? [];
      expect(selections.length).toBeGreaterThanOrEqual(1);
      // Provenance fields are present.
      expect(selections[0]?.sourceId).toBeTruthy();
      expect(selections[0]?.messageId).toBeTruthy();
      // The passage TEXT is never persisted with the selection metadata
      // (references/provenance only — §13.3).
      const selectionsJson = JSON.stringify(selections);
      expect(selectionsJson).not.toContain(passageMarker);

      // --- The redacted request log never recorded the passage text. ---
      const requests = await fakeAi.getRequests();
      const logJson = JSON.stringify(requests);
      expect(logJson).not.toContain(passageMarker);

      await closeApp(app);
    } catch (err) {
      await closeApp(app);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});

// ---------------------------------------------------------------------------
// AC-20: disable AI and browse history — local history remains readable; no
// unauthorized AI call occurs.
// ---------------------------------------------------------------------------

test("AC-20: history remains readable with AI disabled and no provider call occurs", async (_fixtures: unknown, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  try {
    // --- Session 1: local-enabled, create a conversation with history. ---
    await fakeAi.setScenario("stream-text");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: RECOVERABLE_FLAGS_ON,
    });

    const marker = `ac20-history-${Date.now()}`;
    const app1 = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    let conversationId: string | null = null;
    try {
      await openChat(app1);
      await sendAndWait(app1, marker);
      // Capture the conversationId here, while AI is enabled and the
      // `ai-chat-v2:conversations` handler (AI-gated via canUseChat) can
      // resolve it. Session 2 runs hosted-disabled, where that handler is
      // denied — so we cannot discover the id there and must carry it over.
      conversationId = await firstConversationId(app1);
      expect(conversationId).toBeTruthy();
      await closeApp(app1);
    } catch (err) {
      await closeApp(app1);
      throw err;
    }

    // --- Session 2: SAME root but hosted-disabled (AI gate rejects). ---
    await fakeAi.reset();
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "hosted-disabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: RECOVERABLE_FLAGS_ON,
    });
    const app2 = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app2);
      expect(conversationId).toBeTruthy();

      // History search/read are LOCAL (not AI-gated, §13): they must return
      // the records even though AI is disabled. The browse envelope is nested
      // ({ data: { data: result, errorCode } }), so unwrap one level.
      const browse = await invokeBrowse<{
        records?: ReadonlyArray<{ text?: string }>;
      }>(app2, "ai-chat-v2:history-search", {
        conversationId: conversationId as string,
        query: marker,
        limit: 5,
      });
      expect(browse.status).toBe(true);
      const records = browse.result?.records ?? [];
      expect(records.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(records)).toContain(marker);

      // No provider request was made in session 2 — the AI gate rejects
      // before transport, and history browsing is local-only.
      const requests = await fakeAi.getRequests();
      expect(requests.length).toBe(0);

      await closeApp(app2);
    } catch (err) {
      await closeApp(app2);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});

// ---------------------------------------------------------------------------
// §17.2 deletion: clear the conversation (tombstone cascade) and assert the
// tombstoned shapes across search / read / resolve-selections.
// ---------------------------------------------------------------------------

test("§17.2 deletion: cleared conversation yields tombstoned history shapes", async (_fixtures: unknown, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  try {
    await fakeAi.setScenario("stream-text");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: RECOVERABLE_FLAGS_ON,
    });

    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);
      const marker = `deletion-marker-${Date.now()}`;
      await sendAndWait(app, marker);

      const conversationId = await firstConversationId(app);
      expect(conversationId).toBeTruthy();

      // Capture a sourceId from a successful search BEFORE deletion.
      const beforeBrowse = await invokeBrowse<{
        records?: ReadonlyArray<{ sourceId?: string }>;
      }>(app, "ai-chat-v2:history-search", {
        conversationId,
        query: marker,
        limit: 5,
      });
      expect(beforeBrowse.status).toBe(true);
      const sourceId = beforeBrowse.result?.records?.[0]?.sourceId;
      expect(sourceId).toBeTruthy();

      // --- Clear the conversation (tombstone cascade via the IPC handler). ---
      const clearResp = await invokeChannel(
        app,
        "ai-chat-v2:clear-conversation",
        { conversationId }
      );
      expect(clearResp.status).toBe(true);

      // READ of the prior sourceId → SOURCE_UNAVAILABLE / empty records.
      const readBrowse = await invokeBrowse<{
        records?: ReadonlyArray<unknown>;
      }>(app, "ai-chat-v2:history-read", {
        conversationId,
        args: { source_id: sourceId },
      });
      expect(readBrowse.status).toBe(true);
      expect(readBrowse.result?.records ?? []).toHaveLength(0);
      expect(readBrowse.errorCode).toBe("SOURCE_UNAVAILABLE");

      // SEARCH → HISTORY_NO_MATCH (NOT HISTORY_SCOPE_INVALID), with
      // scanComplete:true and indexComplete:false (tombstoned state).
      const searchBrowse = await invokeBrowse<{
        records?: ReadonlyArray<unknown>;
        scanComplete?: boolean;
        indexComplete?: boolean;
      }>(app, "ai-chat-v2:history-search", {
        conversationId,
        query: marker,
        limit: 5,
      });
      expect(searchBrowse.status).toBe(true);
      expect(searchBrowse.result?.records ?? []).toHaveLength(0);
      expect(searchBrowse.errorCode).toBe("HISTORY_NO_MATCH");
      expect(searchBrowse.result?.scanComplete).toBe(true);
      expect(searchBrowse.result?.indexComplete).toBe(false);

      // RESOLVE-SELECTIONS → HISTORY_SCOPE_INVALID (tombstoned/unknown scope).
      const resolveBrowse = await invokeBrowse<{
        resolved?: ReadonlyArray<unknown>;
        rejected?: ReadonlyArray<string>;
      }>(app, "ai-chat-v2:history-resolve-selections", {
        conversationId,
        sourceIds: [sourceId ?? "stale"],
      });
      expect(resolveBrowse.status).toBe(true);
      expect(resolveBrowse.result?.resolved ?? []).toHaveLength(0);
      expect(resolveBrowse.errorCode).toBe("HISTORY_SCOPE_INVALID");

      await closeApp(app);
    } catch (err) {
      await closeApp(app);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});
