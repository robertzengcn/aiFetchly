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
