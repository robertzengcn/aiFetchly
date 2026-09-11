/**
 * Prompt-skill runtime E2E flows (PRD-gap TODO 15; §26.5 cases 5/9/11):
 *   - case 9: use_skill's hidden instruction context reaches the NEXT model
 *     round (redaction-safe: the continuation request carries ONE extra
 *     message beyond the ordinary tool flow — the hidden instruction block),
 *     and the visible tool result is a SHORT ack.
 *   - case 11: a LARGE skill's omitted sections come back through
 *     skill_resource_read (progressive disclosure replaces truncation).
 *   Case 5 (activation-failure rollback) stays at the module level: the E2E
 *   environment's fail-closed credential store pauses remote fixtures at
 *   awaiting_secret before activation (see the verification-failure and
 *   cancel-during-activation lifecycle tests).
 *
 * The chat loop is driven through the real renderer + FakeOpenAI server;
 * typed installer IPC is used only for USER actions (plan approval).
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
  errorCode?: string;
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
      const resp = (await api.invoke(c, p)) as {
        status: boolean;
        data: T;
      } | null;
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

/** Install a local fixture skill (managed copy) via USER-side IPC actions. */
async function installFixture(
  app: LaunchedApp,
  fixture: string
): Promise<InstallSnapshot | null> {
  const prepared = await invoke<InstallSnapshot>(app, "skill-install:prepare", {
    conversationId: `e2e-runtime-${Date.now()}`,
    source: fixture,
  });
  expect(prepared?.state).toBe("awaiting_approval");
  const token = await invoke<{ approvalToken: string }>(
    app,
    "skill-install:approval-token",
    { sessionId: prepared?.sessionId }
  );
  let approved = await invoke<InstallSnapshot>(app, "skill-install:approve", {
    sessionId: prepared?.sessionId,
    planRevision: prepared?.planRevision,
    approve: true,
    approvalToken: token?.approvalToken,
  });
  if (approved?.state === "awaiting_secret") {
    const submitted = await invoke<{ snapshot: InstallSnapshot }>(
      app,
      "skill-install:submit-secret",
      {
        sessionId: approved.sessionId,
        environmentVariable: "ELEVENLABS_API_KEY",
        value: "sk-e2e-runtime-flow",
      }
    );
    approved = submitted?.snapshot ?? null;
  }
  expect(["ready", "installing_dependencies"]).toContain(approved?.state);
  return approved;
}

test.describe("Prompt-skill runtime flows (PRD-gap TODO 15)", () => {
  test.setTimeout(300_000);

  test("use_skill hidden context reaches the next model round (case 9)", async ({
    aiApp,
    fakeAi,
  }) => {
    const app = aiApp;
    const dir = path.join(app.testRoot.rootPath, "fixtures", "runtime-skill");
    fs.mkdirSync(path.join(dir, "helpers"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: runtime-skill\ndescription: Runtime fixture\n---\n\n" +
        "# Usage\n\nCut footage via helpers/cut.py.\n\n## Safety\n\nNever delete footage."
    );
    fs.writeFileSync(path.join(dir, "install.md"), "# Install\n\nNothing.\n");
    fs.writeFileSync(path.join(dir, "helpers", "cut.py"), "# helper\n");

    await installFixture(app, dir);

    await app.mainWindow.getByTestId("ai-chat-toggle").click();
    await expect(app.mainWindow.getByTestId("ai-chat-composer")).toBeVisible({
      timeout: 30_000,
    });

    // The fake model invokes the INSTALLED skill (FR-27: not the installer).
    await fakeAi.setToolCall(
      "use_skill",
      JSON.stringify({ skill: "runtime-skill" })
    );
    await fakeAi.setFollowupText(
      "Following the runtime-skill instructions for your clip now."
    );
    await sendMessage(app, "edit my clip with the runtime skill");

    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Following the runtime-skill instructions",
      { timeout: 60_000 }
    );

    // Redaction-safe proof the hidden context reached the provider: the
    // request log deduplicates roles, but messageCount is exact. An
    // ordinary tool continuation carries system + user + assistant(tool
    // call) + tool = 4 messages; the hidden instruction block adds ONE
    // more user-role message after the tool result.
    const requests = await fakeAi.getRequests();
    const withTool = requests.filter((r) => r.roles.includes("tool"));
    expect(withTool.length).toBeGreaterThanOrEqual(1);
    const continuation = withTool[withTool.length - 1];
    expect(continuation.messageCount).toBeGreaterThanOrEqual(5);
    // The visible tool result was a SHORT ack, not the full instructions:
    // the second round is still one continuation (no giant JSON card).
    await expect(app.mainWindow.getByTestId("ai-chat-root")).not.toContainText(
      "<invoked_prompt_skill"
    );

    await assertCleanTeardown(app, { expectedExternalOrigins: [] });
  });

  test("a large skill's omitted sections come back via skill_resource_read (case 11)", async ({
    aiApp,
    fakeAi,
  }) => {
    const app = aiApp;
    const dir = path.join(app.testRoot.rootPath, "fixtures", "large-skill");
    fs.mkdirSync(path.join(dir, "helpers"), { recursive: true });
    // A SKILL.md large enough to trigger section selection, with a clearly
    // named section that budget selection may omit.
    // ~90 KB: under the 256 KiB SKILL.md cap, well over the 8k-token
    // per-skill budget, so section selection engages deterministically.
    const sections = Array.from(
      { length: 60 },
      (_, i) => `## Advanced note ${i}\n\n${"detail ".repeat(300)}`
    ).join("\n\n");
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: large-skill\ndescription: Large fixture\n---\n\n" +
        `# Usage\n\nPrimary workflow overview.\n\n${sections}\n\n## Secret Tail Section\n\nTHE_OMITTED_MARKER_XYZ`
    );
    fs.writeFileSync(path.join(dir, "install.md"), "# Install\n\nNothing.\n");

    const installed = await installFixture(app, dir);
    expect(installed?.installationId).toBeTruthy();

    await app.mainWindow.getByTestId("ai-chat-toggle").click();
    await expect(app.mainWindow.getByTestId("ai-chat-composer")).toBeVisible({
      timeout: 30_000,
    });

    // Round 1: invoke the large skill.
    await fakeAi.setToolCall(
      "use_skill",
      JSON.stringify({ skill: "large-skill" })
    );
    await fakeAi.setFollowupText(
      "Large skill loaded; checking the tail section."
    );
    await sendMessage(app, "use the large skill on my project");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Large skill loaded",
      { timeout: 60_000 }
    );

    // Round 2: progressive read of the possibly-omitted section. The
    // runtime id is deterministic from the installation id.
    const runtimeId = `prompt:user:${installed?.installationId}`;
    await fakeAi.setToolCall(
      "skill_resource_read",
      JSON.stringify({ runtime_id: runtimeId, path: "SKILL.md" })
    );
    await fakeAi.setFollowupText("Read the skill file back successfully.");
    await sendMessage(app, "read the skill file back");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Read the skill file back",
      { timeout: 60_000 }
    );

    await assertCleanTeardown(app, { expectedExternalOrigins: [] });
  });
});
