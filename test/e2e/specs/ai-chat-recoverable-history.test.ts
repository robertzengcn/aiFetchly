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
 *   AC-01 — Put exact wording early in a conversation; compact THREE times
 *           and restart; the original wording is still retrievable from the
 *           archive (PRD AC-01). Proven through the REAL history-search IPC
 *           against the same isolated root across a controlled relaunch.
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
  const box = composer(app);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.fill(text);
  const send = app.mainWindow.getByTestId("ai-chat-send");
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  const root = app.mainWindow.getByTestId("ai-chat-root");
  // A missed click leaves the empty-state copy and the draft in the
  // composer (seen after heavier prior tests in the same worker). Wait a
  // short interval before retrying so a successful send is not doubled.
  try {
    await expect(root).toContainText(STREAM_TEXT_FINAL, { timeout: 8_000 });
  } catch {
    await expect(send).toBeEnabled({ timeout: 5_000 });
    await send.click();
    await expect(root).toContainText(STREAM_TEXT_FINAL, { timeout: 30_000 });
  }
  await expect(send).toBeVisible({
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

/**
 * Open the history drawer on its Search tab. The drawer boots on Browse;
 * search controls only render after switching tabs.
 */
async function openHistorySearchTab(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-history-drawer-toggle").click();
  await expect(app.mainWindow.getByTestId("ai-history-drawer")).toBeVisible({
    timeout: 15_000,
  });
  await app.mainWindow.getByTestId("ai-history-tab-search").click();
  await expect(
    app.mainWindow.getByTestId("ai-history-search-input")
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Ensure a published generation via STATUS polling and return the terminal
 * snapshot. Design §13.1: nobody awaits a whole batch.
 *
 * Publication may come from the post-turn auto trigger (which fires after
 * every turn through the same bounded coordinator) or from the explicit
 * manual START below — both prove the product path, so START is always
 * issued too (idempotent: it joins or resumes) without assuming which one
 * publishes first.
 *
 * Terminal detection is generation-aware, not state-name-aware: a completed
 * run leaves no active run row, so STATUS reports `queued` WITH a
 * generationId — which still means compacted.
 */
async function startAndAwaitCompacted(
  app: LaunchedApp & { mainStdout?: () => string },
  conversationId: string,
  previousGenerationId?: string
): Promise<{ state?: string; generationId?: string; runId?: string }> {
  // Collect progress broadcasts in-page so a silent run failure is
  // diagnosable (STATUS hides terminal runs by design).
  await app.mainWindow.evaluate(() => {
    const w = window as unknown as {
      api: { receive: (ch: string, fn: (e: unknown) => void) => void };
      __progressEvents: unknown[];
      __progressHooked?: boolean;
    };
    if (w.__progressHooked) return;
    w.__progressEvents = [];
    w.__progressHooked = true;
    w.api.receive("ai-chat-v2:compaction-progress", (e: unknown) => {
      w.__progressEvents.push(e);
    });
  });
  const start = await invokeChannel(app, "ai-chat-v2:compaction-start", {
    conversationId,
  });
  expect(start.status).toBe(true);
  let last: { state?: string; generationId?: string; runId?: string } = {};
  const seen: string[] = [];
  const deadline = Date.now() + 120_000;
  let terminal: string = "waiting";
  while (Date.now() < deadline) {
    const s = await invokeChannel(app, "ai-chat-v2:compaction-status", {
      conversationId,
    });
    last = (s.data ?? {}) as typeof last;
    seen.push(
      `${last.state ?? "?"}${last.runId ? `/${String(last.runId).slice(0, 8)}` : ""}${last.generationId ? "+gen" : ""}`
    );
    // A leftover generation from an earlier cycle is not proof this run
    // published (AC-01 three-compact). Wait until the active generation
    // changes, or until the first cycle publishes any generation.
    if (
      last.generationId &&
      last.generationId !== previousGenerationId
    ) {
      terminal = "completed";
      break;
    }
    if (last.state === "failed" || last.state === "cancelled") {
      terminal = last.state;
      break;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  // eslint-disable-next-line no-console
  console.log(`[ac01] status trajectory: ${seen.join(" → ")}`);
  const progressEvents = await app.mainWindow
    .evaluate(() => {
      const w = window as unknown as { __progressEvents?: unknown[] };
      return w.__progressEvents ?? [];
    })
    .catch(() => []);
  // eslint-disable-next-line no-console
  console.log(`[ac01] progress events: ${JSON.stringify(progressEvents)}`);
  if (terminal === "waiting") {
    // Diagnostic: the run never surfaced — dump main-process compaction logs.
    try {
      const out: string =
        typeof (app as unknown as { mainStdout?: () => string }).mainStdout ===
        "function"
          ? (app as unknown as { mainStdout: () => string }).mainStdout()
          : "";
      const hits = out
        .split("\n")
        .filter((l) => /compact|COMPACTION|Error|error|reject|fail/i.test(l))
        .slice(-40);
      // eslint-disable-next-line no-console
      console.log(`[ac01] main log excerpts:\n${hits.join("\n")}`);
    } catch {
      // Diagnostics must never mask the real assertion below.
    }
  }
  expect(
    `terminal=${terminal} trajectory=[${seen.join(" ")}]`,
    "no published generation within 120s (see [ac01] logs above)"
  ).not.toContain("terminal=waiting");
  return last;
}


async function waitUntilIndexed(
  app: LaunchedApp,
  conversationId: string,
  query: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const b = await invokeBrowse<{ indexComplete?: boolean }>(
          app,
          "ai-chat-v2:history-search",
          { conversationId, query, limit: 1 }
        );
        return b.result?.indexComplete === true;
      },
      { timeout: 30_000, intervals: [1_000] }
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// AC-01: compact → restart → exact recovery from the archive.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures object
test("AC-01: archived wording survives three compactions and a controlled restart", async ({}, testInfo) => {
  test.setTimeout(420_000);
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
      // Five turns: FR-05 retention keeps the newest complete turns (+ live
      // tail) verbatim, so the marker must land several turns back to be
      // eligible for incremental packing. With only two turns the retained
      // suffix covers everything and compaction is a correct no-op.
      // Bulky bodies so incremental packing has source to summarize;
      // tiny one-liners stay inside the retained suffix and compact is a
      // correct no-op (sectionsPacked=0) even after five turns.
      const bulky = (tag: string): string => `${tag}\n${"block ".repeat(200)}`;
      await sendAndWait(app1, bulky(marker));
      await sendAndWait(app1, bulky(`ac01-followup-1-${Date.now()}`));
      await sendAndWait(app1, bulky(`ac01-followup-2-${Date.now()}`));
      await sendAndWait(app1, bulky(`ac01-followup-3-${Date.now()}`));
      await sendAndWait(app1, bulky(`ac01-followup-4-${Date.now()}`));

      // Compact THREE times (PRD AC-01) via the non-blocking START channel.
      // Extra complete turns between runs make each cycle process only NEW
      // eligible history (AC-05) while the original marker stays archived.
      const conversationId = await firstConversationId(app1);
      expect(conversationId).toBeTruthy();

      const generations: string[] = [];
      for (let cycle = 1; cycle <= 3; cycle++) {
        await waitUntilIndexed(app1, conversationId!, marker);
        const terminal = await startAndAwaitCompacted(
          app1,
          conversationId!,
          generations[generations.length - 1]
        );
        expect(
          terminal.generationId,
          `cycle ${cycle} did not publish a generation`
        ).toBeTruthy();
        generations.push(terminal.generationId!);
        if (cycle < 3) {
          await sendAndWait(app1, bulky(`ac01-cycle-${cycle}-a-${Date.now()}`));
          await sendAndWait(app1, bulky(`ac01-cycle-${cycle}-b-${Date.now()}`));
          await sendAndWait(app1, bulky(`ac01-cycle-${cycle}-c-${Date.now()}`));
        }
      }
      expect(generations).toHaveLength(3);
      // Post-turn auto-compact shares the coordinator, so a later START may
      // report sectionsPacked=0 while STATUS still shows the generation that
      // auto just published. Distinct generation ids across the three cycles
      // are the proof that incremental publication actually advanced.
      expect(
        new Set(generations).size,
        `three incremental runs must publish distinct generations, got ${generations.join(",")}`
      ).toBe(3);
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
      // The published generation survived the restart alongside the
      // retrievable originals (summaries are navigation aids, not storage).
      const status2 = await invokeChannel(app2, "ai-chat-v2:compaction-status", {
        conversationId,
      });
      expect(status2.status).toBe(true);
      expect(
        (status2.data as { generationId?: string } | null)?.generationId
      ).toBeTruthy();
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

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures object
test("AC-17: browsing older history without selecting does not grow the model context", async ({}, testInfo) => {
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

      // Open the history drawer on the Search tab and search (browse)
      // WITHOUT selecting anything.
      await openHistorySearchTab(app);
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

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures object
test("AC-18: a selected passage is persisted as references only and clears its chip on acceptance", async ({}, testInfo) => {
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

      // Open the history drawer on the Search tab, search for the passage,
      // and select it.
      await openHistorySearchTab(app);
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

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures object
test("AC-20: history remains readable with AI disabled and no provider call occurs", async ({}, testInfo) => {
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

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures object
test("§17.2 deletion: cleared conversation yields tombstoned history shapes", async ({}, testInfo) => {
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

// ---------------------------------------------------------------------------
// AC-12: forged cross-conversation ids fail closed in the running app.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures object
test("AC-12: source ids from another conversation resolve to nothing without leaking", async ({}, testInfo) => {
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
      // Conversation A holds a uniquely marked turn.
      const markerA = `ac12-secret-${Date.now()}`;
      await sendAndWait(app, markerA);
      const convA = await firstConversationId(app);
      expect(convA).toBeTruthy();

      // Conversation B: brand-new chat + its own turn.
      await app.mainWindow.getByTestId("new-conversation").click();
      await sendAndWait(app, `ac12-other-${Date.now()}`);
      const convB = await firstConversationId(app);
      expect(convB).toBeTruthy();
      expect(convB).not.toBe(convA);

      // A real opaque source id out of conversation A...
      const searchA = await invokeBrowse<{
        records?: ReadonlyArray<{ sourceId?: string; text?: string }>;
      }>(app, "ai-chat-v2:history-search", {
        conversationId: convA,
        query: markerA,
        limit: 5,
      });
      expect(searchA.status).toBe(true);
      const sourceIdA = searchA.result?.records?.[0]?.sourceId;
      expect(sourceIdA).toBeTruthy();

      // ...resolved AGAINST conversation B must fail closed: no records, a
      // scope error, and — critically — none of A's content anywhere. The
      // epoch binding rejects first (HISTORY_SCOPE_INVALID); a forged id
      // carrying B's epoch would fall through to the conversation-scoped row
      // read and fail as SOURCE_UNAVAILABLE instead (unit-covered). Either
      // way nothing leaks.
      const readB = await invokeBrowse<{
        records?: ReadonlyArray<unknown>;
      }>(app, "ai-chat-v2:history-read", {
        conversationId: convB,
        args: { source_id: sourceIdA },
      });
      expect(readB.status).toBe(true);
      expect(readB.result?.records ?? []).toHaveLength(0);
      expect(readB.errorCode).toBe("HISTORY_SCOPE_INVALID");
      expect(JSON.stringify(readB)).not.toContain(markerA);

      const resolveB = await invokeBrowse<{
        resolved?: ReadonlyArray<unknown>;
        rejected?: ReadonlyArray<string>;
      }>(app, "ai-chat-v2:history-resolve-selections", {
        conversationId: convB,
        sourceIds: [sourceIdA ?? "stale"],
      });
      expect(resolveB.status).toBe(true);
      expect(resolveB.result?.resolved ?? []).toHaveLength(0);
      expect(resolveB.result?.rejected ?? []).toContain(sourceIdA);
      expect(resolveB.errorCode).toBe("HISTORY_SCOPE_INVALID");
      expect(JSON.stringify(resolveB)).not.toContain(markerA);

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
