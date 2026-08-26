/**
 * Skill installation E2E (natural-language-skill-installation PRD §26.5 /
 * design §18): install a fixture prompt skill through the REAL typed
 * installer IPC, verify the managed-copy activation on disk under the
 * isolated config home, confirm readiness + catalog discovery, invoke it
 * explicitly via /skill, and prove repeated prepare is idempotent.
 *
 * Isolation: the electronApp fixture redirects AIFETCHLY_CONFIG_HOME,
 * AIFETCHLY_SKILL_STAGING_ROOT, and the credential store into the per-run
 * temp root, so nothing touches real user config or installed skills.
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
  recoverable: boolean;
  errorCode?: string;
}

function makeFixtureSkill(root: string): string {
  const dir = path.join(root, "fixtures", "video-use-skill");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    "---\n" +
      "name: video-use\n" +
      "description: Edit and produce videos\n" +
      "---\n\n" +
      "# Usage\n\nUse ${AIFETCHLY_SKILL_DIR}/helpers for editing.\n\n" +
      "## Safety\n\nNever delete user footage.\n"
  );
  fs.mkdirSync(path.join(dir, "helpers"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "helpers", "cut.py"),
    "# helper\nprint('cut')\n"
  );
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
      const resp = (await api.invoke(c, p)) as {
        status: boolean;
        data: T;
      } | null;
      return resp?.status ? (resp.data as T) : null;
    },
    { channel, payload }
  );
}

test.beforeEach(async ({ aiApp }) => {
  // These specs drive the typed installer through the real preload/IPC path
  // and never need the chat dock UI — waiting for the bridge is enough.
  await aiApp.mainWindow.waitForFunction(
    () => {
      const w = window as unknown as { api?: unknown };
      return Boolean(w.api);
    },
    undefined,
    { timeout: 30_000 }
  );
});

test("install → approve → ready with managed-copy activation + discovery", async ({
  aiApp: app,
}) => {
  const fixture = makeFixtureSkill(app.testRoot.rootPath);
  const conversationId = `e2e-conv-${Date.now()}`;

  // 1. prepare stops at plan review.
  const prepared = await invoke<InstallSnapshot>(app, "skill-install:prepare", {
    conversationId,
    source: fixture,
    constraints: ["read SKILL.md for daily usage"],
  });
  expect(prepared).not.toBeNull();
  expect(prepared?.state).toBe("awaiting_approval");
  expect(prepared?.nextAction).toBe("review-plan");
  expect(prepared?.planRevision).toBeTruthy();

  // 2. approve with the returned revision → activation + readiness (or the
  //    dependency hold when ffmpeg is absent — the skill is still activated).
  const approved = await invoke<InstallSnapshot>(app, "skill-install:approve", {
    sessionId: prepared?.sessionId,
    planRevision: prepared?.planRevision,
    approve: true,
  });
  expect(approved).not.toBeNull();
  expect(["ready", "installing_dependencies"]).toContain(approved?.state);

  // 3. The managed copy lives under the isolated config home, with the
  //    ownership metadata and helper files preserved.
  const activation = path.join(
    app.testRoot.rootPath,
    ".aifetchly",
    "skills",
    "video-use"
  );
  await expect
    .poll(() => fs.existsSync(path.join(activation, "SKILL.md")), {
      timeout: 10_000,
    })
    .toBe(true);
  expect(fs.existsSync(path.join(activation, ".aifetchly-install.json"))).toBe(
    true
  );
  expect(fs.existsSync(path.join(activation, "helpers", "cut.py"))).toBe(true);

  // 4. Status is correlated by session id and reports the same state.
  const status = await invoke<InstallSnapshot>(app, "skill-install:status", {
    sessionId: prepared?.sessionId,
  });
  expect(status?.sessionId).toBe(prepared?.sessionId);
  expect(["ready", "installing_dependencies"]).toContain(status?.state);

  // 5. Repeated prepare for the same source REPORTS the ready installation
  //    (PRD §10.2) — never a second acquisition or checkout.
  const repeat = await invoke<InstallSnapshot>(app, "skill-install:prepare", {
    conversationId: `${conversationId}-2`,
    source: fixture,
  });
  expect(repeat?.state).toBe("ready");
  expect(repeat?.nextAction).toBe("ready");
  expect(repeat?.installationId).toBeTruthy();
  expect(repeat?.sessionId).toMatch(/^installation:/);

  // github.com is the app's known local-ai-runtime manifest poll at startup —
  // unrelated to the installer; allowlist it for the guard assertion.
  await assertCleanTeardown(app, {
    expectedExternalOrigins: ["https://github.com"],
  });
});

test("explicit /skill invocation loads the installed skill", async ({
  aiApp: app,
}) => {
  const fixture = makeFixtureSkill(app.testRoot.rootPath);
  const conversationId = `e2e-slash-${Date.now()}`;

  const prepared = await invoke<InstallSnapshot>(app, "skill-install:prepare", {
    conversationId,
    source: fixture,
  });
  let snapshot = await invoke<InstallSnapshot>(app, "skill-install:approve", {
    sessionId: prepared?.sessionId,
    planRevision: prepared?.planRevision,
    approve: true,
  });
  if (snapshot?.state === "awaiting_secret") {
    snapshot = await invoke<InstallSnapshot>(app, "skill-install:status", {
      sessionId: prepared?.sessionId,
    });
  }
  expect(["ready", "installing_dependencies"]).toContain(snapshot?.state);

  // Explicit invocation through the SAME resolver as use_skill. Returns only
  // the short acknowledgement — never the instruction body.
  const ack = await app.mainWindow.evaluate(
    async ({ conversationId: c }) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (channel: string, data: unknown) => Promise<unknown>;
          };
        }
      ).api;
      const resp = (await api.invoke("prompt-skill:invoke", {
        conversationId: c,
        skill: "video-use",
        arguments: "edit the interview footage gently",
      })) as {
        status: boolean;
        data: {
          status: string;
          runtimeId: string;
          name: string;
          contentHash: string;
          contextRevision: number;
        };
      } | null;
      return resp?.status ? resp.data : null;
    },
    { conversationId }
  );
  expect(ack).not.toBeNull();
  expect(ack?.name).toBe("video-use");
  expect(ack?.status === "loaded" || ack?.status === "already-loaded").toBe(
    true
  );
  expect(String(ack?.runtimeId)).toMatch(/^prompt:user:/);
  expect(JSON.stringify(ack)).not.toContain("Never delete user footage");

  // github.com is the app's known local-ai-runtime manifest poll at startup —
  // unrelated to the installer; allowlist it for the guard assertion.
  await assertCleanTeardown(app, {
    expectedExternalOrigins: ["https://github.com"],
  });
});

test("uninstall removes the owned activation and preserves nothing foreign", async ({
  aiApp: app,
}) => {
  const fixture = makeFixtureSkill(app.testRoot.rootPath);
  const conversationId = `e2e-uninstall-${Date.now()}`;

  const prepared = await invoke<InstallSnapshot>(app, "skill-install:prepare", {
    conversationId,
    source: fixture,
  });
  const approved = await invoke<InstallSnapshot>(app, "skill-install:approve", {
    sessionId: prepared?.sessionId,
    planRevision: prepared?.planRevision,
    approve: true,
  });
  expect(approved?.installationId).toBeTruthy();

  const result = await invoke<{
    ok: boolean;
    removed: string;
    secretsDeleted: number;
  }>(app, "skill-install:uninstall", {
    installationId: approved?.installationId,
  });
  expect(result?.ok).toBe(true);
  expect(result?.removed).toBe("directory");

  const activation = path.join(
    app.testRoot.rootPath,
    ".aifetchly",
    "skills",
    "video-use"
  );
  expect(fs.existsSync(activation)).toBe(false);
  // The FIXTURE source always survives.
  expect(fs.existsSync(path.join(fixture, "SKILL.md"))).toBe(true);

  // github.com is the app's known local-ai-runtime manifest poll at startup —
  // unrelated to the installer; allowlist it for the guard assertion.
  await assertCleanTeardown(app, {
    expectedExternalOrigins: ["https://github.com"],
  });
});
