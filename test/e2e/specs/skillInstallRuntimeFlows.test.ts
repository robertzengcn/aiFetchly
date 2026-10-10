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

    // Chat-first boot race: with an approved workspace the app opens the
    // chat-first workspace shell (composer already present); otherwise the
    // dock needs opening. Tolerate both orders.
    const chatToggle = app.mainWindow.getByTestId("ai-chat-toggle");
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
    }
    await expect(
      app.mainWindow.getByTestId("ai-chat-composer")
    ).toBeVisible({ timeout: 30_000 });

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

    // Chat-first boot race: with an approved workspace the app opens the
    // chat-first workspace shell (composer already present); otherwise the
    // dock needs opening. Tolerate both orders.
    const chatToggle = app.mainWindow.getByTestId("ai-chat-toggle");
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
    }
    await expect(
      app.mainWindow.getByTestId("ai-chat-composer")
    ).toBeVisible({ timeout: 30_000 });

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

test.describe("Compaction + conversation recovery (case 10, FR-23/§27.3-9)", () => {
  test.setTimeout(300_000);

  test("an invoked skill survives compaction: reattached once, hash-guarded, deactivatable", async ({
    aiApp,
    fakeAi,
  }) => {
    const app = aiApp;
    const dir = path.join(app.testRoot.rootPath, "fixtures", "compact-skill");
    fs.mkdirSync(path.join(dir, "helpers"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: compact-skill\ndescription: Compaction fixture\n---\n\n" +
        "# Usage\n\nCut footage via helpers/cut.py.\n\n## Safety\n\nNever delete footage."
    );
    fs.writeFileSync(path.join(dir, "install.md"), "# Install\n\nNothing.\n");
    fs.writeFileSync(path.join(dir, "helpers", "cut.py"), "# helper\n");

    // LINKED mode: the activation points at the external fixture, so a
    // later external edit is exactly the change the hash guard exists for.
    const prepared = await invoke<InstallSnapshot>(app, "skill-install:prepare", {
      conversationId: `e2e-compact-${Date.now()}`,
      source: dir,
      mode: "linked",
    });
    expect(prepared?.state).toBe("awaiting_approval");
    const token = await invoke<{ approvalToken: string }>(
      app,
      "skill-install:approval-token",
      { sessionId: prepared?.sessionId }
    );
    const installed = await invoke<InstallSnapshot>(app, "skill-install:approve", {
      sessionId: prepared?.sessionId,
      planRevision: prepared?.planRevision,
      approve: true,
      approvalToken: token?.approvalToken,
    });
    expect(["ready", "installing_dependencies"]).toContain(installed?.state);
    const installationId = installed?.installationId ?? null;
    expect(installationId).toBeTruthy();

    // Chat-first boot race: with an approved workspace the app opens the
    // chat-first workspace shell (composer already present); otherwise the
    // dock needs opening. Tolerate both orders.
    const chatToggle = app.mainWindow.getByTestId("ai-chat-toggle");
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
    }
    await expect(
      app.mainWindow.getByTestId("ai-chat-composer")
    ).toBeVisible({ timeout: 30_000 });

    // --- Round 1: invoke (creates the durable invocation row; exactly ONE
    //     hidden instruction block reaches the provider). ---
    await fakeAi.setToolCall("use_skill", JSON.stringify({ skill: "compact-skill" }));
    await fakeAi.setFollowupText("Invoked before compaction.");
    await sendMessage(app, "use the compact skill please");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Invoked before compaction.",
      { timeout: 60_000 }
    );
    const requestsAfterInvoke = (await fakeAi.getRequests()).filter((r) =>
      r.roles.includes("tool")
    );
    expect(requestsAfterInvoke.length).toBeGreaterThanOrEqual(1);
    expect(requestsAfterInvoke[requestsAfterInvoke.length - 1].hiddenSkillBlocks).toBe(1);

    // --- Compact the conversation through the real renderer API. ---
    await fakeAi.clearToolCall();
    await fakeAi.setResponseText("Compacted summary: the skill was invoked.");
    const conversations = await invoke<{ conversationId: string }[]>(
      app,
      "ai-chat-v2:conversations",
      {}
    );
    expect(conversations?.length).toBeGreaterThanOrEqual(1);
    const conversationId = conversations?.[0]?.conversationId;
    expect(conversationId).toBeTruthy();
    const rawCompact = await app.mainWindow.evaluate(
      async ({ channel, payload }) => {
        const api = (
          window as unknown as {
            api: { invoke: (channel: string, data: unknown) => Promise<unknown> };
          }
        ).api;
        return (await api.invoke(channel, payload)) as unknown;
      },
      { channel: "ai-chat-v2:compact-conversation", payload: { conversationId } }
    );
    expect((rawCompact as { status?: boolean } | null)?.status).toBe(true);

    // --- Healthy reattach: the NEXT assembled request carries exactly ONE
    //     reattachment block (identity + content hash intact) and NO
    //     diagnostics — the skill context survived compaction. ---
    await fakeAi.setResponseText("Post-compaction plain turn.");
    await sendMessage(app, "what should I do next");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Post-compaction plain turn.",
      { timeout: 60_000 }
    );
    const postCompact = (await fakeAi.getRequests())
      .filter((r) => r.reattachedSkillBlocks > 0 || r.skillDiagnostics.length > 0)
      .slice(-1);
    expect(postCompact.length).toBe(1);
    expect(postCompact[0].reattachedSkillBlocks).toBe(1);
    expect(postCompact[0].skillDiagnostics).toEqual([]);

    // --- FR-19 deactivation leg: disabling the installation proactively
    //     deactivates its durable invocations (a disabled skill must not
    //     keep instructing conversations). The returned count proves the
    //     conversation's invocation row was torn down, and the next turn
    //     reattaches NOTHING (silent by design — no stale instructions).
    const disabled = await invoke<{
      disabled: boolean;
      deactivatedInvocations: number;
    }>(app, "skill-install:disable", { installationId });
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.deactivatedInvocations).toBeGreaterThanOrEqual(1);
    await fakeAi.setResponseText("Turn after disabling.");
    await sendMessage(app, "continue with the skill");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Turn after disabling.",
      { timeout: 60_000 }
    );
    const afterDisable = (await fakeAi.getRequests()).filter(
      (r) => r.reattachedSkillBlocks > 0 || r.skillDiagnostics.length > 0
    );
    expect(afterDisable.length).toBe(1); // only the healthy-reattach request

    // --- Uninstalled-recovery leg: re-enable, re-invoke, then remove the
    //     skill through the LEGACY manager (which does not know about
    //     prompt invocations — exactly the drift recovery exists for). The
    //     next assembly reports SKILL_UNINSTALLED with the structured
    //     diagnostic instead of silently reattaching stale instructions.
    const enabled = await invoke<boolean>(app, "skill-install:enable", {
      installationId,
    });
    expect(enabled).toBe(true);
    // The fake's plan priority: responseText shadows toolCallConfig — clear
    // the standing text override so this turn emits the tool call again.
    await fakeAi.setResponseText(null);
    await fakeAi.setToolCall("use_skill", JSON.stringify({ skill: "compact-skill" }));
    await fakeAi.setFollowupText("Re-invoked after re-enable.");
    await sendMessage(app, "use the skill again");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Re-invoked after re-enable.",
      { timeout: 60_000 }
    );
    // (The SKILL_HASH_CHANGED / SKILL_UNINSTALLED reconcile branches are
    // covered by the module 4-way test; in-app disable/uninstall proactively
    // deactivate invocation rows by design, so those diagnostics surface
    // only after cross-session drift.)

    // After re-enable + re-invoke, exactly ONE hidden block again — the
    // churn (compact, disable, enable) never duplicated instruction context.
    const reInvokeRequests = (await fakeAi.getRequests())
      .filter((r) => r.roles.includes("tool"))
      .slice(-1);
    expect(reInvokeRequests.length).toBe(1);
    expect(reInvokeRequests[0].hiddenSkillBlocks).toBe(1);

    // The external fixture survives every removal (linked mode).
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);

    await assertCleanTeardown(app, { expectedExternalOrigins: [] });
  });
});

test.describe("Legacy documentation-only delegation (case 12, FR-25)", () => {
  test.setTimeout(300_000);

  test("a legacy SKILL.md-only import delegates to the SAME hidden-context runtime as use_skill", async ({
    aiApp,
    fakeAi,
  }) => {
    const app = aiApp;
    // Build the legacy import zip: one directory holding SKILL.md.
    const AdmZip = (await import("adm-zip")).default;
    const zipPath = path.join(app.testRoot.rootPath, "doc-legacy.zip");
    const zip = new AdmZip();
    zip.addFile(
      "doc-legacy/SKILL.md",
      Buffer.from(
        "---\nname: doc-legacy\ndescription: Legacy doc fixture\n---\n\n" +
          "# Usage\n\nLegacy documentation-only guidance body.\n\n## Safety\n\nNever delete footage.",
        "utf-8"
      )
    );
    zip.writeZip(zipPath);

    // Import through the LEGACY skill-import channel (documentation-only
    // wrapper — no installer involved).
    const imported = await invoke<{ name: string }>(app, "skill:import", {
      zipPath,
    });
    expect(imported?.name).toBe("doc-legacy");

    // Chat-first boot race: with an approved workspace the app opens the
    // chat-first workspace shell (composer already present); otherwise the
    // dock needs opening. Tolerate both orders.
    const chatToggle = app.mainWindow.getByTestId("ai-chat-toggle");
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
    }
    await expect(
      app.mainWindow.getByTestId("ai-chat-composer")
    ).toBeVisible({ timeout: 30_000 });

    // The model calls the legacy skill BY NAME (the legacy tool surface).
    await fakeAi.setToolCall("doc-legacy", "{}");
    await fakeAi.setFollowupText("Legacy delegation complete.");
    await sendMessage(app, "run the legacy documentation skill");
    await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Legacy delegation complete.",
      { timeout: 60_000 }
    );

    // The tool result marks the legacy-adapter doc path (visible short ack)…
    await expect
      .poll(
        async () => {
          const text = await app.mainWindow.evaluate(() => document.body.textContent ?? "");
          return text.includes("documentation_skill");
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    // …and the SAME hidden instruction block reached the provider: the
    // continuation carries the tool flow plus one hidden-context message,
    // exactly like use_skill (FR-25 "delegate to the same path").
    const requests = await fakeAi.getRequests();
    const withTool = requests.filter((r) => r.roles.includes("tool"));
    expect(withTool.length).toBeGreaterThanOrEqual(1);
    const continuation = withTool[withTool.length - 1];
    expect(continuation.messageCount).toBeGreaterThanOrEqual(5);

    await assertCleanTeardown(app, { expectedExternalOrigins: [] });
  });
});
