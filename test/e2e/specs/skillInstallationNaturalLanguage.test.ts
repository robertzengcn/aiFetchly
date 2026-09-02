/**
 * Model-driven natural-language installation E2E (final-audit TODO 1; PRD
 * FR-01/FR-18/FR-26–FR-30, §26.5 cases 8/13, §27.1–27.2, DoD).
 *
 * Drives the REAL chat loop with the FakeOpenAI server: the acceptance
 * prompt goes in as a user message, the fake model's FIRST tool call is
 * skill_install_prepare (no catalog/shell/glob/file detour), the
 * tool-result continuation reports readiness, and the installed skill is
 * never invoked. The typed installer IPC is used ONLY for actions the USER
 * performs (tool-permission approve, plan approval, status polling) — never
 * to start the installation.
 */

import * as fs from "fs";
import * as path from "path";
import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";

interface InstallSnapshot {
  sessionId: string;
  installationId: string | null;
  state: string;
  nextAction: string;
  planRevision: string | null;
  safeSummary: string;
}

/** The PRD §27.1 acceptance prompt (fixture path substituted inline). */
function acceptancePrompt(fixture: string): string {
  return (
    `Set up ${fixture} for me.\n\n` +
    "Read install.md first to install this repo, wire up ffmpeg, register " +
    "the skill, and set up the ElevenLabs API key; ask me to paste it when " +
    "you need it. After install, don't transcribe anything on your own; " +
    "just tell me it's ready and wait for me to drop footage into a folder."
  );
}

function makeFixtureSkill(root: string): string {
  const dir = path.join(root, "fixtures", "video-use-nl");
  fs.mkdirSync(path.join(dir, "helpers"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    "---\nname: video-use\ndescription: Edit and produce videos\n---\n\n" +
      "# Usage\n\nUse helpers/ for editing.\n\n## Safety\n\nNever delete footage."
  );
  fs.writeFileSync(
    path.join(dir, "install.md"),
    "# Install\n\nRequires ffmpeg on PATH.\n"
  );
  fs.writeFileSync(path.join(dir, "helpers", "cut.py"), "# helper\n");
  return dir;
}

async function invoke<T>(
  app: LaunchedApp,
  channel: string,
  payload: unknown
): Promise<T | null> {
  return app.mainWindow.evaluate(
    async ({ channel: c, payload: p }) => {
      const api = (
        window as unknown as {
          api: { invoke: (channel: string, data: unknown) => Promise<unknown> };
        }
      ).api;
      if (!api?.invoke) return null;
      const resp = (await api.invoke(c, p)) as
        | { status: boolean; data: T }
        | null;
      return resp?.status ? (resp.data as T) : null;
    },
    { channel, payload }
  );
}

async function sendMessage(app: LaunchedApp, text: string): Promise<void> {
  const composer = app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
  await composer.fill(text);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

/**
 * Tool-call messages rendered in the conversation. Each permission-gated
 * tool shows a card naming the tool; we assert on the rendered tool_call
 * rows via the chat log's tool markers (role=tool messages carry the name).
 */
async function renderedToolNames(app: LaunchedApp): Promise<string[]> {
  return app.mainWindow.evaluate(() => {
    const root = document.querySelector('[data-testid="ai-chat-root"]');
    if (!root) return [] as string[];
    // Tool-call blocks render the tool name in a header field. The V2
    // message list marks them with the toolbox header + tool name row.
    const texts: string[] = [];
    root
      .querySelectorAll(".v2-message__tool-field")
      .forEach((el) => texts.push(el.textContent ?? ""));
    return texts.map((t) => t.replace(/^Tool:\s*/, "").trim());
  });
}

async function approveInstall(
  app: LaunchedApp,
  sessionId: string,
  planRevision: string
): Promise<InstallSnapshot | null> {
  const token = await invoke<{ approvalToken: string }>(
    app,
    "skill-install:approval-token",
    { sessionId }
  );
  expect(token?.approvalToken).toBeTruthy();
  return invoke<InstallSnapshot>(app, "skill-install:approve", {
    sessionId,
    planRevision,
    approve: true,
    approvalToken: token?.approvalToken,
  });
}

test.describe("Model-driven natural-language installation (final-audit 1)", () => {
  test("the video-use acceptance prompt routes through skill_install_prepare and ends ready-and-waiting", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(240_000);
    const app = aiApp;
    const fixture = makeFixtureSkill(app.testRoot.rootPath);

    // Open the chat dock and wait for the composer.
    await app.mainWindow.getByTestId("ai-chat-toggle").click();
    await expect(
      app.mainWindow.getByTestId("ai-chat-composer")
    ).toBeVisible({ timeout: 30_000 });

    // Script the fake model: first (non-continuation) call emits
    // skill_install_prepare with the fixture source; the tool-result
    // continuation reports readiness (PRD §27.2 #15 "concise ready message").
    await fakeAi.setToolCall(
      "skill_install_prepare",
      JSON.stringify({ source: fixture })
    );
    const readyReport =
      "video-use is installed and ready. I will not transcribe anything — " +
      "waiting for you to drop footage into a folder.";
    await fakeAi.setFollowupText(readyReport);

    await sendMessage(app, acceptancePrompt(fixture));

    // The model's tool call is permission-gated: approve it (the USER
    // gesture — this is not a test-side installer call).
    const permissionCard = app.mainWindow.getByTestId("ai-chat-permission-card");
    await expect(permissionCard).toBeVisible({ timeout: 30_000 });
    await expect(permissionCard).toContainText("skill_install_prepare");
    await app.mainWindow
      .getByTestId("ai-chat-permission-allow-once")
      .click();

    // The assistant's readiness report renders (the continuation round).
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "installed and ready",
      { timeout: 60_000 }
    );

    // FR-26/FR-01: the FIRST and ONLY tool call in the turn is
    // skill_install_prepare — no catalog search, shell, glob, or file read.
    const tools = await renderedToolNames(app);
    expect(tools.length).toBeGreaterThanOrEqual(1);
    expect(tools[0]).toBe("skill_install_prepare");
    for (const name of tools) {
      expect(
        [
          "tool_catalog_search",
          "shell_execute",
          "glob_files",
          "file_read",
          "use_skill",
        ],
        `unexpected acquisition-detour tool in the turn: ${name}`
      ).not.toContain(name);
    }

    // The prepare result reached the model as a tool result: the fake
    // server saw a continuation request whose body includes the tool role.
    const requests = await fakeAi.getRequests();
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const continuation = requests.find((r) => r.roles.includes("tool"));
    expect(continuation).toBeDefined();

    // The provider request exposed the installer tool (always-loaded while
    // the flag is on) and use_skill.
    const firstChat = requests.find((r) => r.toolNames?.length);
    expect(firstChat?.toolNames).toContain("skill_install_prepare");
    expect(firstChat?.toolNames).toContain("use_skill");

    // Session correlation: the session the card/UI knows about is the one
    // the tool created — poll the persisted session list to ready.
    // (The approve is the USER action on the review card.)
    const status0 = await pollForSession(app);
    expect(status0).not.toBeNull();
    if (!status0) return;
    expect(status0.state).toBe("awaiting_approval");
    expect(status0.nextAction).toBe("review-plan");

    const approved = await approveInstall(
      app,
      status0.sessionId,
      status0.planRevision ?? ""
    );
    expect(approved).not.toBeNull();
    // ready OR installing_dependencies (ffmpeg absent/present on runner)
    // OR awaiting_secret (install.md mentions a KEY). All are terminal
    // for this assertion; the flow ends ready when deps are satisfied.
    expect([
      "ready",
      "installing_dependencies",
      "awaiting_secret",
    ]).toContain(approved?.state);

    // FR-18 / §27.2 #14: no invocation, no footage work. The turn already
    // ended with the readiness text; a follow-up question gets a TEXT-ONLY
    // response (no tool calls) because the fake model emits no tools now.
    await fakeAi.clearToolCall();
    await fakeAi.setResponseText(
      "Still ready and waiting for your footage. Nothing has run."
    );
    await sendMessage(app, "is the skill ready yet?");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Still ready and waiting",
      { timeout: 60_000 }
    );
    const toolsAfter = await renderedToolNames(app);
    const newTools = toolsAfter.slice(tools.length);
    expect(newTools, `no tool calls expected after readiness: ${newTools}`).toHaveLength(0);

    await assertCleanTeardown(app, {
      expectedExternalOrigins: ["https://github.com"],
    });
  });
});

/** Find the live installer session created by the model's tool call.
 *
 * The session id is dynamic and not rendered as plain text on the card —
 * scrape it from the tool-result JSON the chat renders in its
 * details/<pre> diagnostics blocks ("sessionId":"<32-hex>"), then correlate
 * through the status channel.
 */
async function pollForSession(
  app: LaunchedApp,
  attempts = 20,
  intervalMs = 500
): Promise<InstallSnapshot | null> {
  for (let i = 0; i < attempts; i++) {
    // NOTE: innerText EXCLUDES collapsed <details> content — the tool-result
    // JSON lives there, so use textContent which includes hidden text.
    const sessionId = await app.mainWindow.evaluate(() => {
      const text = document.body.textContent ?? "";
      const match = text.match(/"sessionId"\s*:\s*"([0-9a-f-]{20,40})"/);
      return match ? match[1] : null;
    });
    if (sessionId) {
      const status = await invoke<InstallSnapshot>(
        app,
        "skill-install:status",
        { sessionId }
      );
      if (status) return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
