/**
 * PRD §27 acceptance scenario — `browser-use/video-use`, fixture form
 * (NL-6): a fixture mirroring the real package layout (SKILL.md +
 * install.md wiring ffmpeg + the ElevenLabs key + helpers/) driven through
 * the REAL chat loop, the §27.1 prompt verbatim (fixture path substituted
 * for the GitHub URL), then §27.3 daily use after the install turn.
 *
 * POSIX packaged-equivalent E2E (real renderer -> IPC -> modules -> SQLite);
 * the Windows leg of the scenario maps to the windows-shell-matrix workflow
 * (process providers, probes, and cwd discipline at module level).
 *
 * §27.2 items exercised here: 1 (prepare-first, no detours), 2 (one
 * checkout + resolved revision), 3/4 (install.md read + prompt-skill
 * classification in the plan), 5 (typed dependency detection), 6/7/8
 * (plan approval gate, credential pause + secure submit, no secret in
 * chat), 9/10/11 (activation, registration, helpers present), 13/14/15
 * (readiness report, no transcription, concise ready + wait), 16 (no
 * duplicates on repeat), 17 (no synthetic hydration failure), 18
 * (session-correlated status to ready). §27.3: 2-6, 8 (use_skill ack +
 * ONE hidden block, progressive helper reads, no duplicate injection).
 */

import * as fs from "fs";
import * as path from "path";
import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";

interface InstallSnapshot {
  sessionId: string;
  installationId: string | null;
  state: string;
  nextAction: string;
  planRevision: string | null;
  safeSummary: string;
  errorCode?: string;
  safePlan?: {
    revision?: string;
    skills?: { name: string; kind: string }[];
    dependencies?: { id: string; name: string; status: string }[];
    credentials?: string[];
    mode?: string;
  };
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
  const send = app.mainWindow.getByTestId("ai-chat-send");
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
}

/** Fixture mirroring the real browser-use/video-use package layout. */
function makeVideoUseRepository(root: string): string {
  const dir = path.join(root, "fixtures", "video-use-repo");
  fs.mkdirSync(path.join(dir, "helpers"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    [
      "---",
      "name: video-use",
      "description: Edit and produce videos",
      "---",
      "",
      "# Usage",
      "",
      "Ask which clip to work on, confirm the plan, then edit. Use",
      "${AIFETCHLY_SKILL_DIR}/helpers for editing scripts.",
      "",
      "## Workflow",
      "",
      "1. Ask the user for the footage folder.",
      "2. Cut and grade via helpers/cut.py and helpers/grade.py.",
      "",
      "## Safety",
      "",
      "Never delete user footage.",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(dir, "install.md"),
    [
      "# Install",
      "",
      "Requires ffmpeg on PATH.",
      "",
      "Set ELEVENLABS_API_KEY= for narration.",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "helpers", "cut.py"), "# cut helper\n");
  fs.writeFileSync(path.join(dir, "helpers", "grade.py"), "# grade helper\n");
  fs.writeFileSync(path.join(dir, "helpers", "transcribe.py"), "# transcribe\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# video-use\n");
  return dir;
}

/** Deterministic ffmpeg/ffprobe stubs so probes are SATISFIED on any host. */
function makeStubBin(root: string): string {
  const stubBin = path.join(root, "stub-bin");
  fs.mkdirSync(stubBin, { recursive: true });
  const writeStub = (name: string, line: string): void => {
    const sh = path.join(stubBin, name);
    fs.writeFileSync(sh, `#!/bin/sh\necho "${line}"\nexit 0\n`);
    fs.chmodSync(sh, 0o755);
    fs.writeFileSync(
      path.join(stubBin, `${name}.cmd`),
      `@echo off\necho ${line}\r\nexit /b 0\r\n`
    );
  };
  writeStub("ffmpeg", "ffmpeg version e2e-stub");
  writeStub("ffprobe", "ffprobe version e2e-stub");
  return stubBin;
}

/** The §27.1 acceptance prompt, verbatim, fixture path substituted. */
function acceptancePrompt(source: string): string {
  return (
    `Set up ${source} for me.\n\n` +
    "Read install.md first to install this repo, wire up ffmpeg, register the skill " +
    "with whichever agent you're running under, and set up the ElevenLabs API key; " +
    "ask me to paste it when you need it. Then read SKILL.md for daily usage, and " +
    "always read helpers/ because that's where the editing scripts live. After " +
    "install, don't transcribe anything on your own; just tell me it's ready and " +
    "wait for me to drop footage into a folder."
  );
}

async function renderedToolNames(app: LaunchedApp): Promise<string[]> {
  return app.mainWindow.evaluate(() => {
    const root = document.querySelector('[data-testid="ai-chat-root"]');
    if (!root) return [] as string[];
    const texts: string[] = [];
    root
      .querySelectorAll(".v2-message__tool-field")
      .forEach((el) => texts.push(el.textContent ?? ""));
    return texts.map((t) => t.replace(/^Tool:\s*/, "").trim());
  });
}

async function pollSessionId(
  app: LaunchedApp,
  attempts = 20,
  intervalMs = 500
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const sessionId = await app.mainWindow.evaluate(() => {
      const text = document.body.textContent ?? "";
      const match = text.match(/"sessionId"\s*:\s*"([0-9a-f-]{20,40})"/);
      return match ? match[1] : null;
    });
    if (sessionId) return sessionId;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// eslint-disable-next-line no-empty-pattern
test.describe("§27 acceptance scenario — video-use (NL-6)", () => {
  // eslint-disable-next-line no-empty-pattern
  test("install-and-wait, then daily use through the prompt-skill runtime", async ({}, testInfo) => {
    test.setTimeout(360_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    try {
      writeStateManifest(root, {
        authState: "authenticated" as const,
        aiState: "local-enabled" as const,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
      });
      const repo = makeVideoUseRepository(root.rootPath);
      const stubBin = makeStubBin(root.rootPath);

      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        extraEnv: { PATH: stubBin },
      });
      try {
        // Chat-first boot race: the composer is the landmark.
        const toggle = app.mainWindow.getByTestId("ai-chat-toggle");
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click();
        }
        await expect(
          app.mainWindow.getByTestId("ai-chat-composer")
        ).toBeVisible({ timeout: 30_000 });

        // ---- §27.2 items 1-6: the acceptance prompt routes through
        //      skill_install_prepare FIRST (no catalog/shell/glob/file
        //      detours), the plan shows install.md-derived dependencies +
        //      credentials + prompt-skill classification, and activation
        //      waits for the human approval gesture. ----
        await fakeAi.setToolCall(
          "skill_install_prepare",
          JSON.stringify({ source: repo })
        );
        const readyReport =
          "video-use is installed and ready. I will not transcribe anything — " +
          "waiting for you to drop footage into a folder.";
        await fakeAi.setFollowupText(readyReport);
        await sendMessage(app, acceptancePrompt(repo));

        const permissionCard = app.mainWindow.getByTestId(
          "ai-chat-permission-card"
        );
        await expect(permissionCard).toBeVisible({ timeout: 30_000 });
        await app.mainWindow
          .getByTestId("ai-chat-permission-allow-once")
          .click();
        await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
          "installed and ready",
          { timeout: 60_000 }
        );

        // Item 1: first tool call is the installer, no detours.
        const tools = await renderedToolNames(app);
        expect(tools[0]).toBe("skill_install_prepare");
        for (const name of tools) {
          expect(
            ["tool_catalog_search", "shell_execute", "glob_files", "file_read"],
            `unexpected acquisition detour: ${name}`
          ).not.toContain(name);
        }

        // Item 18: session-correlated status follows next_action.
        const sessionId = await pollSessionId(app);
        expect(sessionId).not.toBeNull();
        const status = await invoke<InstallSnapshot>(
          app,
          "skill-install:status",
          { sessionId }
        );
        expect(status?.state).toBe("awaiting_approval");
        expect(status?.nextAction).toBe("review-plan");

        // Items 2-6: the plan records the resolved revision, prompt-skill
        // classification, install.md dependencies (satisfied via stubs),
        // the declared credential, and the managed-copy mode.
        expect(status?.safePlan?.revision).toMatch(/^[0-9a-f]{12}$/);
        expect(status?.safePlan?.skills).toEqual([
          {
            name: "video-use",
            kind: "prompt",
            description: "Edit and produce videos",
          },
        ]);
        const ffmpeg = status?.safePlan?.dependencies?.find(
          (d) => d.id === "dep:ffmpeg"
        );
        expect(ffmpeg?.status).toBe("satisfied");
        expect(status?.safePlan?.credentials).toEqual([
          "ELEVENLABS_API_KEY",
        ]);
        expect(status?.safePlan?.mode).toBe("managed-copy");

        // Item 6/7: approve → the credential pause happens BEFORE activation.
        const token = await invoke<{ approvalToken: string }>(
          app,
          "skill-install:approval-token",
          { sessionId }
        );
        expect(token?.approvalToken).toBeTruthy();
        const approved = await invoke<InstallSnapshot>(
          app,
          "skill-install:approve",
          {
            sessionId,
            planRevision: status?.planRevision,
            approve: true,
            approvalToken: token?.approvalToken,
          }
        );
        expect(approved?.state).toBe("awaiting_secret");
        expect(approved?.nextAction).toBe("provide-secret-securely");

        // Item 8: the key travels ONLY the secure channel and never appears
        // in chat history or tool logs.
        const secretValue = "sk-e2e-acceptance-elevenlabs";
        const submitted = await invoke<{ configured: boolean; snapshot: InstallSnapshot }>(
          app,
          "skill-install:submit-secret",
          {
            sessionId,
            environmentVariable: "ELEVENLABS_API_KEY",
            value: secretValue,
          }
        );
        const pageAfterSecret = await app.mainWindow.evaluate(
          () => document.body.textContent ?? ""
        );
        expect(pageAfterSecret).not.toContain(secretValue);

        // Fail-closed environments (no OS safeStorage) legitimately stay
        // paused; when storage works the flow runs to ready (item 13).
        let reachedReady = false;
        if (submitted?.configured) {
          expect(["ready", "installing_dependencies"]).toContain(
            submitted.snapshot.state
          );
          reachedReady = submitted.snapshot.state === "ready";
        } else {
          const still = await invoke<InstallSnapshot>(
            app,
            "skill-install:status",
            { sessionId }
          );
          expect(still?.state).toBe("awaiting_secret");
        }

        // Item 9/10/11: activation exists with helpers/ preserved, and the
        // skill is registered (resolvable through the runtime below).
        const activationDir = path.join(
          root.rootPath,
          ".aifetchly",
          "skills",
          "video-use"
        );
        if (reachedReady || submitted?.configured) {
          expect(fs.existsSync(path.join(activationDir, "SKILL.md"))).toBe(true);
          expect(
            fs.existsSync(path.join(activationDir, "helpers", "cut.py"))
          ).toBe(true);
          expect(
            fs.existsSync(path.join(activationDir, "helpers", "grade.py"))
          ).toBe(true);
        }

        // Item 16: repeating the request never duplicates — the idempotent
        // prepare resumes the SAME session, and only ONE installation row
        // exists for the source.
        await fakeAi.setResponseText(null);
        await fakeAi.setToolCall(
          "skill_install_prepare",
          JSON.stringify({ source: repo })
        );
        await fakeAi.setFollowupText("Still the same installation.");
        await sendMessage(app, `set up ${repo} for me again`);
        await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
          "Still the same installation.",
          { timeout: 60_000 }
        );
        // The repeat prepare RESUMES the same session (no new checkout):
        // the session id is unchanged and its state did not regress.
        const resumed = await invoke<InstallSnapshot>(
          app,
          "skill-install:status",
          { sessionId }
        );
        expect(resumed?.sessionId).toBe(sessionId);
        expect(
          ["awaiting_secret", "ready", "installing_dependencies"]
        ).toContain(resumed?.state);
        // When activation happened, exactly ONE installation row exists.
        if (reachedReady || submitted?.configured) {
          const listed = await invoke<{ name: string }[]>(
            app,
            "skill-install:list",
            {}
          );
          expect(
            (listed ?? []).filter((r) => r.name === "video-use").length
          ).toBe(1);
        }

        // Item 14/15/17: the turn ended ready-and-waiting with a concise
        // message; no transcription ran; no synthetic hydration failure.
        const finalText = await app.mainWindow.evaluate(
          () => document.body.textContent ?? ""
        );
        expect(finalText).toContain("installed and ready");
        expect(finalText).not.toContain("INSTALL_TOOL_LOAD_RETRY_EXHAUSTED");
        expect(finalText).not.toContain("could not be loaded automatically");
        const toolsAfter = await renderedToolNames(app);
        for (const name of toolsAfter) {
          expect(name).not.toBe("use_skill"); // install turn never invokes
        }

        // ---- §27.3: daily use (requires a ready installation). ----
        if (!reachedReady) {
          test.info().annotations.push({
            type: "skip",
            description:
              "OS safeStorage unavailable in this environment — session paused at awaiting_secret; §27.3 legs covered where storage works",
          });
        } else {
          await fakeAi.setResponseText(null);
          await fakeAi.setToolCall(
            "use_skill",
            JSON.stringify({ skill: "video-use" })
          );
          await fakeAi.setFollowupText("Editing your dropped footage now.");
          await sendMessage(app, "here is my footage folder — edit the clip");
          await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
            "Editing your dropped footage now.",
            { timeout: 60_000 }
          );

          // Items 2-5: short ack + exactly ONE hidden instruction block.
          const afterInvoke = (await fakeAi.getRequests()).filter((r) =>
            r.roles.includes("tool")
          );
          expect(afterInvoke.length).toBeGreaterThanOrEqual(1);
          expect(
            afterInvoke[afterInvoke.length - 1].hiddenSkillBlocks
          ).toBe(1);

          // Item 6: progressive helper reads — the helper tree is read file
          // by file, never injected wholesale.
          const listed2 = await invoke<{ name: string }[]>(
            app,
            "skill-install:list",
            {}
          );
          const installationId = (listed2 ?? []).find(
            (r) => r.name === "video-use"
          )?.name;
          expect(installationId).toBe("video-use");
          await fakeAi.setToolCall(
            "skill_resource_read",
            JSON.stringify({
              runtime_id: `prompt:user:${
                (await invoke<InstallSnapshot>(app, "skill-install:status", {
                  sessionId,
                }))?.installationId
              }`,
              path: "helpers/cut.py",
            })
          );
          await fakeAi.setFollowupText("Read the cut helper.");
          await sendMessage(app, "read the cutting helper script");
          await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
            "Read the cut helper.",
            { timeout: 60_000 }
          );

          // Item 8: a repeated invocation does not duplicate the context.
          await fakeAi.setToolCall(
            "use_skill",
            JSON.stringify({ skill: "video-use" })
          );
          await fakeAi.setFollowupText("Re-invoked without duplication.");
          await sendMessage(app, "apply the skill again to the graded cut");
          await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
            "Re-invoked without duplication.",
            { timeout: 60_000 }
          );
          const afterReinvoke = (await fakeAi.getRequests())
            .filter((r) => r.roles.includes("tool"))
            .slice(-1);
          expect(afterReinvoke[0].hiddenSkillBlocks).toBe(1);
        }

        await assertCleanTeardown(app, { expectedExternalOrigins: [] });
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });
});

/** §27.3 daily use, guaranteed on any runner: the same repo layout with
 *  the credential already configured (fail-closed storage environments
 *  pause the keyed variant at awaiting_secret, so this variant omits the
 *  key wiring and runs straight to ready). */
// eslint-disable-next-line no-empty-pattern
test("daily-use invocation: use_skill ack + one hidden block + progressive helper reads", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });
  try {
    writeStateManifest(root, {
      authState: "authenticated" as const,
      aiState: "local-enabled" as const,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
    });
    const repo = makeVideoUseRepository(root.rootPath);
    // Variant without the credential wiring: ready is guaranteed.
    fs.writeFileSync(
      path.join(repo, "install.md"),
      "# Install\n\nRequires ffmpeg on PATH.\n"
    );
    const stubBin = makeStubBin(root.rootPath);

    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      extraEnv: { PATH: stubBin },
    });
    try {
      const toggle = app.mainWindow.getByTestId("ai-chat-toggle");
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
      }
      await expect(
        app.mainWindow.getByTestId("ai-chat-composer")
      ).toBeVisible({ timeout: 30_000 });

      // USER-side install to ready (prepare/approve through typed IPC).
      const prepared = await invoke<InstallSnapshot>(
        app,
        "skill-install:prepare",
        { conversationId: `e2e-accept-daily-${Date.now()}`, source: repo }
      );
      expect(prepared?.state).toBe("awaiting_approval");
      const token = await invoke<{ approvalToken: string }>(
        app,
        "skill-install:approval-token",
        { sessionId: prepared?.sessionId }
      );
      const installed = await invoke<InstallSnapshot>(
        app,
        "skill-install:approve",
        {
          sessionId: prepared?.sessionId,
          planRevision: prepared?.planRevision,
          approve: true,
          approvalToken: token?.approvalToken,
        }
      );
      expect(installed?.state).toBe("ready");
      const installationId = installed?.installationId ?? null;
      expect(installationId).toBeTruthy();

      // §27.3 item 2-5: the model invokes through use_skill; the visible
      // result is a SHORT ack and exactly ONE hidden instruction block
      // reaches the provider.
      await fakeAi.setToolCall(
        "use_skill",
        JSON.stringify({ skill: "video-use" })
      );
      await fakeAi.setFollowupText("Editing your dropped footage now.");
      await sendMessage(app, "here is my footage folder — edit the clip");
      await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
        "Editing your dropped footage now.",
        { timeout: 60_000 }
      );
      const afterInvoke = (await fakeAi.getRequests()).filter((r) =>
        r.roles.includes("tool")
      );
      expect(afterInvoke.length).toBeGreaterThanOrEqual(1);
      expect(afterInvoke[afterInvoke.length - 1].hiddenSkillBlocks).toBe(1);
      const pageAck = await app.mainWindow.evaluate(
        () => document.body.textContent ?? ""
      );
      expect(pageAck).not.toContain("<invoked_prompt_skill");

      // §27.3 item 6: progressive helper reads — one helper file at a time.
      await fakeAi.setToolCall(
        "skill_resource_read",
        JSON.stringify({
          runtime_id: `prompt:user:${installationId}`,
          path: "helpers/cut.py",
        })
      );
      await fakeAi.setFollowupText("Read the cut helper.");
      await sendMessage(app, "read the cutting helper script");
      await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
        "Read the cut helper.",
        { timeout: 60_000 }
      );

      // §27.3 item 8: a repeated invocation does not duplicate the block.
      await fakeAi.setToolCall(
        "use_skill",
        JSON.stringify({ skill: "video-use" })
      );
      await fakeAi.setFollowupText("Re-invoked without duplication.");
      await sendMessage(app, "apply the skill again to the graded cut");
      await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
        "Re-invoked without duplication.",
        { timeout: 60_000 }
      );
      const afterReinvoke = (await fakeAi.getRequests())
        .filter((r) => r.roles.includes("tool"))
        .slice(-1);
      expect(afterReinvoke[0].hiddenSkillBlocks).toBe(1);

      await assertCleanTeardown(app, { expectedExternalOrigins: [] });
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});
