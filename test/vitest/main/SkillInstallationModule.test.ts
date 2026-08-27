/**
 * End-to-end installer tests through SkillInstallationModule with a local
 * video-use-style fixture (design §18.1): prepare → review plan → approve →
 * activate → verify → ready, plus idempotency, plan-revision binding, and
 * the awaiting-secret pause.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { SkillInstallationModule } from "@/modules/SkillInstallationModule";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";

const tmpDir = path.join(os.tmpdir(), "aifetchly-skill-install-module");

let fixtureRoot: string;
let configHome: string;
let stagingRoot: string;

function makeVideoUseFixture(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "video-use-fixture-"));
  fs.writeFileSync(
    path.join(repo, "SKILL.md"),
    "---\nname: video-use\ndescription: Edit and produce videos\n---\n\n" +
      "# Usage\n\nUse ${AIFETCHLY_SKILL_DIR}/helpers for editing.\n\n" +
      "## Safety\n\nNever delete user footage."
  );
  fs.writeFileSync(
    path.join(repo, "install.md"),
    "# Install\n\nRequires ffmpeg on PATH. Set ELEVENLABS_API_KEY= for narration.\n"
  );
  fs.mkdirSync(path.join(repo, "helpers"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "helpers", "cut.py"),
    "# helper\nprint('cut')"
  );
  // A real local Git repository: commit + resolved revision provenance.
  execSync("git init -q", { cwd: repo });
  execSync("git add -A", { cwd: repo });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', {
    cwd: repo,
  });
  return repo;
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);

  fixtureRoot = makeVideoUseFixture();
  configHome = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-home-"));
  stagingRoot = path.join(configHome, "staging");
  process.env.AIFETCHLY_CONFIG_HOME = configHome;
  process.env.AIFETCHLY_SKILL_STAGING_ROOT = stagingRoot;
  process.env.AIFETCHLY_SKILL_INSTALL_ENABLED = "true";
  getDefaultPromptSkillCatalog().replaceSource("installer:0", []);
});

afterEach(() => {
  delete process.env.AIFETCHLY_CONFIG_HOME;
  delete process.env.AIFETCHLY_SKILL_STAGING_ROOT;
  delete process.env.AIFETCHLY_SKILL_INSTALL_ENABLED;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(configHome, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const runtimeId of [...getAllRuntimeIds()]) {
    getDefaultPromptSkillCatalog().remove(runtimeId);
  }
});

function getAllRuntimeIds(): string[] {
  return getDefaultPromptSkillCatalog()
    .list({})
    .map((s) => s.runtimeId);
}

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

describe("SkillInstallationModule — video-use acceptance sequence", () => {
  it("prepare → plan review → approve → ready with registry discovery", async () => {
    const module = new SkillInstallationModule();

    // 1. prepare stops at awaiting_approval with a reviewable plan.
    const prepared = await module.prepare({
      conversationId: "conv-acceptance",
      source: fixtureRoot,
      constraints: ["read install.md first", "wire up ffmpeg"],
    });
    expect(prepared.state).toBe("awaiting_approval");
    expect(prepared.nextAction).toBe("review-plan");
    expect(prepared.planRevision).not.toBeNull();

    // 2. approve with the WRONG plan revision is rejected.
    const stale = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: "deadbeefdeadbeef",
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
    expect(stale.errorCode).toBe("PLAN_REVISION_MISMATCH");

    // 3. unknown session ids fail before mutation.
    const unknown = await module.getStatus("no-such-session");
    expect(unknown.errorCode).toBe("INSTALL_SESSION_REQUIRED");

    // 4. approve with the correct revision. A declared credential (from
    // install.md) pauses at awaiting_secret BEFORE activation (§19.3);
    // resumeAfterSecret simulates the secure channel completing.
    let approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
    if (approved.state === "awaiting_secret") {
      expect(approved.nextAction).toBe("provide-secret-securely");
      approved = await module.resumeAfterSecret(prepared.sessionId);
    }
    // ffmpeg present on this runner → ready; missing → hold at
    // installing_dependencies. Either way the skill is activated and
    // discovered by the runtime catalog.
    expect(["ready", "installing_dependencies"]).toContain(approved.state);
    expect(approved.installationId).not.toBeNull();

    const catalog = getDefaultPromptSkillCatalog();
    const found = catalog.resolve("video-use", {});
    expect(found.definition).not.toBeNull();
    expect(found.definition?.canonicalRoot).toContain(
      path.join(configHome, ".aifetchly", "skills")
    );

    // 5. status is correlated by session id.
    const status = await module.getStatus(prepared.sessionId);
    expect(status.sessionId).toBe(prepared.sessionId);
    expect(["ready", "installing_dependencies", "awaiting_secret"]).toContain(
      status.state
    );
  }, 120_000);

  it("repeated prepare after approval REPORTS the ready installation (§10.2)", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-ready-report",
      source: fixtureRoot,
    });
    let approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
    if (approved.state === "awaiting_secret") {
      approved = await module.resumeAfterSecret(prepared.sessionId);
    }
    expect(["ready", "installing_dependencies"]).toContain(approved.state);

    const repeat = await module.prepare({
      conversationId: "conv-ready-report-2",
      source: fixtureRoot,
    });
    expect(repeat.state).toBe("ready");
    expect(repeat.nextAction).toBe("ready");
    expect(repeat.sessionId).toMatch(/^installation:/);
    expect(repeat.installationId).toBe(approved.installationId);
  }, 120_000);

  it("approve pauses at awaiting_secret BEFORE activation, with the identity the secure channel needs (§19.3 / C3)", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-secret-pause",
      source: fixtureRoot,
    });
    const approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
    // install.md declares ELEVENLABS_API_KEY= → deterministic pause.
    expect(approved.state).toBe("awaiting_secret");
    expect(approved.nextAction).toBe("provide-secret-securely");
    // The installation identity exists BEFORE activation — without it the
    // SUBMIT_SECRET IPC cannot key the credential store (review C3).
    expect(approved.installationId).not.toBeNull();
    // Nothing activated while the secret is outstanding.
    expect(
      fs.existsSync(
        path.join(configHome, ".aifetchly", "skills", "video-use")
      )
    ).toBe(false);
    expect(
      getDefaultPromptSkillCatalog().resolve("video-use", {}).definition
    ).toBeNull();

    const resumed = await module.resumeAfterSecret(prepared.sessionId);
    expect(["ready", "installing_dependencies"]).toContain(resumed.state);
    // The resumed activation carries the SAME installation identity the
    // credential was stored under.
    expect(resumed.installationId).toBe(approved.installationId);
  }, 120_000);

  it("a model-originated approve without the token is rejected (D1)", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-token-guard",
      source: fixtureRoot,
    });
    // No approvalToken — exactly what a model-originated tool call supplies.
    const rejected = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
    });
    expect(rejected.errorCode).toBe("APPROVAL_REQUIRED");
    expect(rejected.state).toBe("awaiting_approval");
    // Nothing activated by the rejected approval.
    expect(
      fs.existsSync(path.join(configHome, ".aifetchly", "skills", "video-use"))
    ).toBe(false);

    // The renderer card's token unlocks the same call.
    const token = await module.getApprovalToken(prepared.sessionId);
    expect(token).not.toBeNull();
    let approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: token as string,
    });
    if (approved.state === "awaiting_secret") {
      approved = await module.resumeAfterSecret(prepared.sessionId);
    }
    expect(["ready", "installing_dependencies"]).toContain(approved.state);

    // A WRONG token is rejected too.
    const second = await module.prepare({
      conversationId: "conv-token-wrong",
      source: fixtureRoot,
      sessionId: `fresh-${Date.now()}`,
    });
    const wrong = await module.approve({
      sessionId: second.sessionId,
      planRevision: second.planRevision as string,
      approve: true,
      approvalToken: "0".repeat(48),
    });
    expect(wrong.errorCode).toBe("APPROVAL_REQUIRED");
  }, 120_000);

  it("verification failure rolls back the activation and fails the session (D2)", async () => {
    const { SkillActivationService } = await import(
      "@/service/SkillActivationService"
    );
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-rollback",
      source: fixtureRoot,
    });
    const realVerify = SkillActivationService.prototype.verifyActivation;
    SkillActivationService.prototype.verifyActivation = () => false;
    try {
      let failed = await module.approve({
        sessionId: prepared.sessionId,
        planRevision: prepared.planRevision as string,
        approve: true,
        approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
      if (failed.state === "awaiting_secret") {
        failed = await module.resumeAfterSecret(prepared.sessionId);
      }
      expect(failed.state).toBe("failed");
      expect(failed.errorCode).toBe("ACTIVATION_VERIFICATION_FAILED");
      // The half-installed activation is gone and the skill is NOT
      // registered for discovery.
      expect(
        fs.existsSync(path.join(configHome, ".aifetchly", "skills", "video-use"))
      ).toBe(false);
      expect(
        getDefaultPromptSkillCatalog().resolve("video-use", {}).definition
      ).toBeNull();
    } finally {
      SkillActivationService.prototype.verifyActivation = realVerify;
    }
  }, 120_000);

  it("double approve with the same revision is idempotent (D2)", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-double",
      source: fixtureRoot,
    });
    const token = (await module.getApprovalToken(prepared.sessionId)) ?? "";
    const args = {
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: token,
    };
    let first = await module.approve(args);
    if (first.state === "awaiting_secret") {
      first = await module.resumeAfterSecret(prepared.sessionId);
    }
    const firstInstallation = first.installationId;
    // A duplicate approve (renderer retry / late message) returns the
    // terminal snapshot WITHOUT creating a second installation.
    const second = await module.approve(args);
    expect(["ready", "installing_dependencies"]).toContain(second.state);
    expect(second.installationId).toBe(firstInstallation);
    const activation = path.join(configHome, ".aifetchly", "skills", "video-use");
    const count = fs.readdirSync(path.dirname(activation)).filter(
      (n) => n === "video-use"
    ).length;
    expect(count).toBe(1);
  }, 120_000);

  it("a source with no supported package fails with SKILL_FORMAT_INVALID (D2)", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "empty-src-"));
    try {
      fs.writeFileSync(path.join(empty, "README.md"), "# nothing here");
      const module = new SkillInstallationModule();
      const snapshot = await module.prepare({
        conversationId: "conv-empty",
        source: empty,
      });
      expect(snapshot.state).toBe("failed");
      expect(snapshot.errorCode).toBe("SKILL_FORMAT_INVALID");
      const status = await module.getStatus("never-a-session");
      expect(status.errorCode).toBe("INSTALL_SESSION_REQUIRED");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  }, 60_000);

  it("rejects traversal-shaped session ids at the schema boundary (S1)", async () => {
    const { SkillInstallPrepareArgsSchema } = await import(
      "@/entityTypes/skillInstallationTypes"
    );
    const parsed = SkillInstallPrepareArgsSchema.safeParse({
      source: "https://github.com/a/b",
      sessionId: "../../..",
    });
    expect(parsed.success).toBe(false);
  });

  it("repeated prepare resumes the active session (no duplicate acquisition)", async () => {
    const module = new SkillInstallationModule();
    const first = await module.prepare({
      conversationId: "conv-idem",
      source: fixtureRoot,
    });
    const second = await module.prepare({
      conversationId: "conv-idem-2",
      source: fixtureRoot,
    });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.state).toBe("awaiting_approval");
  }, 120_000);

  it("approve: false cancels and removes staging", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-cancel",
      source: fixtureRoot,
    });
    const cancelled = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: false,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
    expect(cancelled.state).toBe("cancelled");
  }, 120_000);

  it("cancel mid-flight also works through the cancel entry point", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-cancel2",
      source: fixtureRoot,
    });
    const cancelled = await module.cancel(prepared.sessionId);
    expect(cancelled.state).toBe("cancelled");
  }, 120_000);

  it("prepare rejects unsupported sources with a structured error", async () => {
    const module = new SkillInstallationModule();
    const snapshot = await module.prepare({
      conversationId: "conv-bad",
      source: "not a source at all",
    });
    expect(snapshot.state).toBe("failed");
    expect(snapshot.errorCode).toBe("SOURCE_ACQUISITION_FAILED");
  }, 60_000);

  it("secret-shaped tool arguments are rejected by the zod schema", async () => {
    const { SkillInstallPrepareArgsSchema } = await import(
      "@/entityTypes/skillInstallationTypes"
    );
    const parsed = SkillInstallPrepareArgsSchema.safeParse({
      source: "https://github.com/a/b",
      constraints: ["ELEVENLABS_API_KEY=sk-abcdefghijklmnop1234"],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((i) => i.message.includes("secret"))
    ).toBe(true);
  });
});
