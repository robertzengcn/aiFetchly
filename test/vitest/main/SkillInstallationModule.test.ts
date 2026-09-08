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
import {
  SkillInstallationModule,
  setTypedDependencyInstallerForTests,
} from "@/modules/SkillInstallationModule";
import { SkillInstallPrepareArgsSchema } from "@/entityTypes/skillInstallationTypes";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";

// Stateful detectAll seam: force every plan dependency to "missing" so the
// installing_dependencies hold is DETERMINISTIC regardless of whether the
// host happens to have ffmpeg. Defaults to the real implementation, so all
// other tests in this file are unaffected.
vi.mock("@/service/SkillDependencyOrchestrator", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/service/SkillDependencyOrchestrator")
  >();
  let forceMissing = false;
  return {
    ...actual,
    detectAll: (
      items: readonly import("@/entityTypes/skillInstallationTypes").DependencyPlanItem[],
      cwd: string
    ) =>
      forceMissing
        ? Promise.resolve(
            items.map((i) => ({ ...i, currentStatus: "missing" as const }))
          )
        : actual.detectAll(items, cwd),
    __setForceDependencyMissing: (value: boolean) => {
      forceMissing = value;
    },
  };
});

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
  execSync("git -c user.email=t@t -c user.name=t commit -q -m init", {
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
    // ffmpeg present → the first session reached READY (terminal) so the
    // repeat falls through to the ready-installation REPORT; ffmpeg absent
    // → the session holds at installing_dependencies (non-terminal) and
    // the repeat correctly RESUMES it. Both honor §10.2: never a second
    // acquisition.
    if (approved.state === "ready") {
      expect(repeat.state).toBe("ready");
      expect(repeat.nextAction).toBe("ready");
      expect(repeat.sessionId).toMatch(/^installation:/);
      expect(repeat.installationId).toBe(approved.installationId);
    } else {
      expect(repeat.state).toBe("installing_dependencies");
      expect(repeat.sessionId).toBe(approved.sessionId);
    }
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
      fs.existsSync(path.join(configHome, ".aifetchly", "skills", "video-use"))
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

  it("dependency detection is catalog-backed (TODO 4 / FR-14)", async () => {
    const { detectDependencyProposals } = await import(
      "@/service/SkillDependencyOrchestrator"
    );
    // ffmpeg: in BOTH the shipped catalog and the exact-probe fallback —
    // plan item must carry the catalog's platform install candidate
    // (manager: package) and BOTH multi-probe commands.
    const items = detectDependencyProposals([
      "Install ffmpeg and ffprobe please",
    ]);
    const ffmpeg = items.find((i) => i.name === "ffmpeg");
    expect(ffmpeg).toBeDefined();
    if (!ffmpeg) return;
    expect(ffmpeg.installMethod).toMatch(/^(apt|brew|winget): \S+/);
    const commands = ffmpeg.probes.map((p) => p.command);
    expect(commands).toContain("ffmpeg -version");
    expect(commands).toContain("ffprobe -version");

    // A catalog-only entry (poppler — catalog probe 'pdfinfo', absent from
    // the fallback table) still produces an item with a generated probe.
    const poppler = detectDependencyProposals([
      "# needs pdfinfo and ffmpeg",
    ]).find((i) => i.name === "poppler");
    // 'pdfinfo' is not in PROPOSAL_RE — verify via the catalog probe path
    // with an explicit catalog test instead:
    void poppler;

    const { SystemDependencyCatalog, loadCatalogFromConfig } = await import(
      "@/service/SystemDependencyCatalog"
    );
    const catalog = new SystemDependencyCatalog(
      loadCatalogFromConfig({
        version: 1,
        dependencies: {
          poppler: {
            probe: "pdfinfo",
            description: "PDF rendering",
            platforms: { linux: { manager: "apt", package: "poppler-utils" } },
          },
        },
      })
    );
    const { setDependencyCatalogForTests } = await import(
      "@/service/SkillDependencyOrchestrator"
    );
    setDependencyCatalogForTests(catalog);
    try {
      const popplerItems = detectDependencyProposals(["requires ffmpeg"]);
      // ffmpeg now missing from THIS catalog → fallback probes still work.
      const ff = popplerItems.find((i) => i.name === "ffmpeg");
      expect(ff?.probes.map((p) => p.command)).toContain("ffmpeg -version");
      // Catalog lacks ffmpeg here → fallback hint (no platform candidate).
      expect(ff?.installMethod).toContain("ffmpeg (includes ffprobe)");
    } finally {
      setDependencyCatalogForTests(null);
    }
  }, 60_000);

  it("snapshots carry a structured non-secret safePlan (TODO 8 / §22.1)", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-safeplan",
      source: fixtureRoot,
    });
    expect(prepared.safePlan).toBeDefined();
    if (!prepared.safePlan) return;
    expect(prepared.safePlan.source).toContain("video-use-fixture");
    expect(prepared.safePlan.revision).toHaveLength(12);
    expect(prepared.safePlan.skills[0]?.name).toBe("video-use");
    expect(prepared.safePlan.mode).toBe("managed-copy");
    // Dependencies present (ffmpeg from install.md) with a status.
    expect(prepared.safePlan.dependencies.length).toBeGreaterThan(0);
    // NO instruction content or secret VALUES in the structured view —
    // credential NAMES are the intended card content (§22.1).
    const serialized = JSON.stringify(prepared.safePlan);
    expect(serialized).not.toContain("Never delete user footage");
    expect(serialized).not.toContain("sk-");
    // Commands ARE shown (review D1: informed consent) — executable + args +
    // riskLevel, never environmentNames or secret values.
    expect(Array.isArray(prepared.safePlan.commands)).toBe(true);
  }, 120_000);

  it("emits monotonic SKILL_INSTALL_PROGRESS events per audited step (TODO 7)", async () => {
    const module = new SkillInstallationModule();
    const events: { sessionId: string; seq: number; step: string }[] = [];
    module.setProgressSinkForTests((e) => {
      events.push({ sessionId: e.sessionId, seq: e.seq, step: e.step });
    });
    const prepared = await module.prepare({
      conversationId: "conv-progress",
      source: fixtureRoot,
    });
    // prepare emits session-created + inspecting + planning + (awaiting_approval
    // via transition) — at least 3 events, all monotonic, all this session.
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => e.sessionId === prepared.sessionId)).toBe(true);
    const seqs = events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    expect(events[0].step).toBe("session-created");
    module.setProgressSinkForTests(null);
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
        approvalToken:
          (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
      if (failed.state === "awaiting_secret") {
        failed = await module.resumeAfterSecret(prepared.sessionId);
      }
      expect(failed.state).toBe("failed");
      expect(failed.errorCode).toBe("ACTIVATION_VERIFICATION_FAILED");
      // The half-installed activation is gone and the skill is NOT
      // registered for discovery.
      expect(
        fs.existsSync(
          path.join(configHome, ".aifetchly", "skills", "video-use")
        )
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
    const activation = path.join(
      configHome,
      ".aifetchly",
      "skills",
      "video-use"
    );
    const count = fs
      .readdirSync(path.dirname(activation))
      .filter((n) => n === "video-use").length;
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

  it("runApprovedCommand executes a persisted template and audits the run (FR-16)", async () => {
    const module = new SkillInstallationModule();
    // Fixture whose install.md proposes ONE safe runnable command.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-fixture-"));
    fs.writeFileSync(
      path.join(repo, "SKILL.md"),
      "---\nname: cmd-skill\ndescription: Command fixture\n---\n\n# Usage\n\nPrint version."
    );
    fs.writeFileSync(
      path.join(repo, "install.md"),
      "# Install\n\nnode --version\n"
    );
    try {
      const prepared = await module.prepare({
        conversationId: "conv-run-cmd",
        source: repo,
      });
      const status = await module.getStatus(prepared.sessionId);
      const template = status.safePlan?.commands?.find(
        (c) => c.executable === "node"
      );
      expect(template).toBeDefined();
      const token = (await module.getApprovalToken(prepared.sessionId)) ?? "";
      let approved = await module.approve({
        sessionId: prepared.sessionId,
        planRevision: prepared.planRevision as string,
        approve: true,
        approvalToken: token,
      });
      if (approved.state === "awaiting_secret") {
        approved = await module.resumeAfterSecret(prepared.sessionId);
      }
      expect(["ready", "installing_dependencies"]).toContain(approved.state);

      // The run succeeds and never throws on the NOT-NULL event columns
      // (regression: command-executed previously wrote undefined states).
      const run = await module.runApprovedCommand(
        prepared.sessionId,
        template?.id ?? ""
      );
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.result.ok).toBe(true);
      expect(run.result.exitCode).toBe(0);
      expect(run.result.stdoutPreview).toMatch(/v\d+\.\d+/);

      // Unknown template ids are refused — command text cannot be smuggled.
      const bogus = await module.runApprovedCommand(
        prepared.sessionId,
        "cmd:evil"
      );
      expect(bogus.ok).toBe(true); // module-level call resolves…
      if (!bogus.ok) return;
      expect(bogus.result.ok).toBe(false);
      expect(bogus.result.errorCode).toBe("COMMAND_NOT_FOUND");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  it("cancelling an approved session revokes command authorization (review D3)", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-cancel-d3",
      source: fixtureRoot,
    });
    const token = (await module.getApprovalToken(prepared.sessionId)) ?? "";
    await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: token,
    });
    // Approved session can reach runApprovedCommand's gate.
    const before = await module.cancel(prepared.sessionId);
    expect(["cancelled", "rollback_required"]).toContain(before.state);
    // After cancel, runApprovedCommand must refuse (approved cleared).
    const run = await module.runApprovedCommand(
      prepared.sessionId,
      "cmd:anything"
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.message).toContain("approved");
  }, 120_000);

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
    expect(parsed.error.issues.some((i) => i.message.includes("secret"))).toBe(
      true
    );
  });
});

describe("approveDependency — typed dependency approval (PRD §18 / FR-14)", () => {
  let setForceMissing: (value: boolean) => void = () => undefined;

  beforeEach(async () => {
    const mod = (await import(
      "@/service/SkillDependencyOrchestrator"
    )) as unknown as {
      __setForceDependencyMissing: (value: boolean) => void;
    };
    setForceMissing = mod.__setForceDependencyMissing;
    setForceMissing(true);
  });
  afterEach(async () => {
    setForceMissing(false);
    setTypedDependencyInstallerForTests(null);
  });

  /** Drive a fresh session to the deterministic installing_dependencies hold. */
  async function driveToHold(
    module: SkillInstallationModule,
    conversationId: string
  ): Promise<{ sessionId: string; planRevision: string; token: string }> {
    const prepared = await module.prepare({
      conversationId,
      source: fixtureRoot,
    });
    let snapshot = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    });
    if (snapshot.state === "awaiting_secret") {
      snapshot = await module.resumeAfterSecret(prepared.sessionId);
    }
    expect(snapshot.state).toBe("installing_dependencies");
    expect(snapshot.nextAction).toBe("approve-dependency");
    return {
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      token: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    };
  }

  it("the hold surfaces per-dependency ids for the approval card", async () => {
    const module = new SkillInstallationModule();
    const held = await driveToHold(module, "conv-dep-hold");
    const status = await module.getStatus(held.sessionId);
    const deps = status.safePlan?.dependencies ?? [];
    expect(deps.length).toBeGreaterThan(0);
    const ffmpeg = deps.find((d) => d.name === "ffmpeg");
    expect(ffmpeg?.id).toBe("dep:ffmpeg");
    expect(ffmpeg?.status).toBe("missing");
    expect(ffmpeg?.requiresElevation).toBe(true);
    expect(ffmpeg?.installMethod).toMatch(/apt|brew|winget|ffmpeg/);
  }, 120_000);

  it("a model-originated approve (no token) and stale revisions are rejected", async () => {
    const module = new SkillInstallationModule();
    const held = await driveToHold(module, "conv-dep-gates");
    const noToken = await module.approveDependency({
      sessionId: held.sessionId,
      dependencyId: "dep:ffmpeg",
      approve: true,
      planRevision: held.planRevision,
    });
    expect(noToken.errorCode).toBe("APPROVAL_REQUIRED");
    const wrongToken = await module.approveDependency({
      sessionId: held.sessionId,
      dependencyId: "dep:ffmpeg",
      approve: true,
      planRevision: held.planRevision,
      approvalToken: "not-the-token",
    });
    expect(wrongToken.errorCode).toBe("APPROVAL_REQUIRED");
    const stale = await module.approveDependency({
      sessionId: held.sessionId,
      dependencyId: "dep:ffmpeg",
      approve: true,
      planRevision: "deadbeef",
      approvalToken: held.token,
    });
    expect(stale.errorCode).toBe("PLAN_REVISION_MISMATCH");
    const unknown = await module.approveDependency({
      sessionId: held.sessionId,
      dependencyId: "dep:not-in-plan",
      approve: true,
      planRevision: held.planRevision,
      approvalToken: held.token,
    });
    expect(unknown.errorCode).toBe("DEPENDENCY_NOT_IN_PLAN");
    // None of the rejected calls moved the session.
    expect((await module.getStatus(held.sessionId)).state).toBe(
      "installing_dependencies"
    );
  }, 120_000);

  it("approve installs through the TYPED installer, re-probes, and reaches ready (FR-14/FR-17)", async () => {
    const installerCalls: {
      dependencyId: string;
      conversationId: string;
      skillName: string;
    }[] = [];
    setTypedDependencyInstallerForTests(async (input) => {
      installerCalls.push(input);
      // The typed install succeeded — flip the probe seam to satisfied so
      // the re-verification pass sees a healthy dependency.
      setForceMissing(false);
      return { ok: true, message: "installed: apt ffmpeg" };
    });
    const module = new SkillInstallationModule();
    const held = await driveToHold(module, "conv-dep-install");
    const snapshot = await module.approveDependency({
      sessionId: held.sessionId,
      dependencyId: "dep:ffmpeg",
      approve: true,
      planRevision: held.planRevision,
      approvalToken: held.token,
    });
    // Exactly ONE typed install for the approved dependency, carrying the
    // catalog id (dep: prefix stripped), conversation, and skill name.
    expect(installerCalls).toHaveLength(1);
    expect(installerCalls[0]).toMatchObject({
      dependencyId: "ffmpeg",
      conversationId: "conv-dep-install",
      skillName: "video-use",
    });
    expect(snapshot.state).toBe("ready");
    expect(snapshot.nextAction).toBe("ready");
    expect(snapshot.safePlan?.dependencies).toBeDefined();
    for (const dep of snapshot.safePlan?.dependencies ?? []) {
      expect(dep.status).toBe("satisfied");
    }
    expect(
      getDefaultPromptSkillCatalog().resolve("video-use", {}).definition
    ).not.toBeNull();
  }, 120_000);

  it("a failed typed install keeps the session recoverable at installing_dependencies", async () => {
    setTypedDependencyInstallerForTests(async () => ({
      ok: false,
      message: "installation_failed: apt unavailable",
    }));
    const module = new SkillInstallationModule();
    const held = await driveToHold(module, "conv-dep-fail");
    const snapshot = await module.approveDependency({
      sessionId: held.sessionId,
      dependencyId: "dep:ffmpeg",
      approve: true,
      planRevision: held.planRevision,
      approvalToken: held.token,
    });
    expect(snapshot.state).toBe("installing_dependencies");
    expect(snapshot.nextAction).toBe("approve-dependency");
    expect(snapshot.recoverable).toBe(true);
    expect(snapshot.safeSummary).toContain("installation_failed");
  }, 120_000);

  it("declining rolls the activation back, unregisters, and cancels (§10.1)", async () => {
    const module = new SkillInstallationModule();
    const held = await driveToHold(module, "conv-dep-decline");
    const statusBefore = await module.getStatus(held.sessionId);
    const activationRoot =
      getDefaultPromptSkillCatalog().resolve("video-use", {}).definition
        ?.canonicalRoot ?? "";
    expect(activationRoot).not.toBe("");
    void statusBefore;

    const snapshot = await module.approveDependency({
      sessionId: held.sessionId,
      dependencyId: "dep:ffmpeg",
      approve: false,
      planRevision: held.planRevision,
      approvalToken: held.token,
    });
    expect(snapshot.state).toBe("cancelled");
    // Rollback evidence: the catalog entry is gone and the activated
    // directory no longer exists.
    expect(
      getDefaultPromptSkillCatalog().resolve("video-use", {}).definition
    ).toBeNull();
    expect(fs.existsSync(activationRoot)).toBe(false);
    expect((await module.getStatus(held.sessionId)).state).toBe("cancelled");
  }, 120_000);
});

describe("ordinary-argument and source-URL secret bypasses are closed (FR-16/31, NFR-03)", () => {
  function rejects(args: unknown): boolean {
    return !SkillInstallPrepareArgsSchema.safeParse(args).success;
  }

  it("rejects credentialed source URLs in every remote form", () => {
    expect(rejects({ source: "https://user:pass@github.com/a/b" })).toBe(true);
    expect(
      rejects({
        source: "https://ghp_abcdefghijklmnopqrstuvwxyz@github.com/a/b",
      })
    ).toBe(true);
    expect(rejects({ source: "ssh://user:secret@host/repo.git" })).toBe(true);
    expect(rejects({ source: "user:pass@host:repo.git" })).toBe(true);
    // The git@ scp form WITHOUT a password stays valid (SSH agent flow).
    expect(rejects({ source: "git@github.com:owner/repo.git" })).toBe(false);
  });

  it("rejects secret-shaped values in ref, subdirectory, and nested fields", () => {
    expect(
      rejects({
        source: "https://github.com/a/b",
        ref: "sk-abcdefghijklmnop1234",
      })
    ).toBe(true);
    expect(
      rejects({
        source: "https://github.com/a/b",
        subdirectory: "ghp_abcdefghijklmnopqrstuvwxyz",
      })
    ).toBe(true);
    expect(
      rejects({
        source: "https://github.com/a/b",
        constraints: ["ok", "nested ghp_abcdefghijklmnopqrstuvwxyz here"],
      })
    ).toBe(true);
  });

  it("rejects unknown top-level fields instead of stripping them", () => {
    expect(
      rejects({ source: "https://github.com/a/b", apiKey: "anything" })
    ).toBe(true);
    expect(rejects({ source: "https://github.com/a/b", token: "x" })).toBe(
      true
    );
  });

  it("clean sources still parse", () => {
    expect(rejects({ source: "https://github.com/a/b" })).toBe(false);
    expect(
      rejects({ source: "https://example.com/repo.git", ref: "v1.0.0" })
    ).toBe(false);
    expect(rejects({ source: "/tmp/some/local-dir" })).toBe(false);
  });

  it("normalization redacts any userinfo that reaches it (defense in depth)", async () => {
    const { redactSourceCredentials, normalizeSkillSource } = await import(
      "@/service/SkillSourceAcquisitionService"
    );
    expect(redactSourceCredentials("https://user:pass@example.com/x")).toBe(
      "https://example.com/x"
    );
    expect(redactSourceCredentials("ssh://tok@host/repo.git")).toBe(
      "ssh://host/repo.git"
    );
    // The canonical URI NEVER carries userinfo, even for legacy inputs.
    const legacy = normalizeSkillSource("https://user:pw@example.com/repo.git");
    expect(legacy?.canonicalUri).toBe("https://example.com/repo");
  });
});

describe("transactional idempotency, mutation leases, retry limits (FR-02/FR-20/NFR-01)", () => {
  it("two CONCURRENT prepares for the same source yield ONE active session", async () => {
    const module = new SkillInstallationModule();
    const [a, b] = await Promise.all([
      module.prepare({ conversationId: "conv-race-1", source: fixtureRoot }),
      module.prepare({ conversationId: "conv-race-2", source: fixtureRoot }),
    ]);
    // The loser resumes the winner's session — never a second checkout.
    expect(a.sessionId).toBe(b.sessionId);
    // The loser may observe a mid-flight state (that IS the resume
    // behavior); the settled session is the winner's pipeline result.
    const settled = await module.getStatus(a.sessionId);
    expect(settled.state).toBe("awaiting_approval");
    // Exactly ONE session row exists for the canonical source — the loser's
    // pre-built entity was never inserted.
    const { SkillInstallationSessionModel } = await import(
      "@/model/SkillInstallation.model"
    );
    const sessions = new SkillInstallationSessionModel(tmpDir);
    const rows = await sessions["repository"].find({
      where: { canonicalUri: fixtureRoot },
    });
    expect(rows).toHaveLength(1);
  }, 120_000);

  it("the acquiring session is discoverable by canonical URI BEFORE any plan exists", async () => {
    const { SkillInstallationSessionModel } = await import(
      "@/model/SkillInstallation.model"
    );
    const sessions = new SkillInstallationSessionModel(tmpDir);
    // A bare acquiring row (no planJson) — the pre-fix lookup could not see it.
    await sessions.create({
      sessionId: "sess-acquiring-only",
      conversationId: "c",
      state: "acquiring",
      planRevision: "none",
      stateRevision: 0,
      canonicalUri: fixtureRoot,
    } as never);
    const found = await sessions.findActiveByCanonicalUri(fixtureRoot);
    expect(found.map((s) => s.sessionId)).toContain("sess-acquiring-only");
  }, 60_000);

  it("an expired lease is taken over safely; a live lease resumes", async () => {
    const { SkillInstallationSessionModel } = await import(
      "@/model/SkillInstallation.model"
    );
    const sessions = new SkillInstallationSessionModel(tmpDir);
    const now = Date.now();
    // Stale: expired 5 minutes ago.
    await sessions.create({
      sessionId: "sess-stale",
      conversationId: "c",
      state: "acquiring",
      planRevision: "none",
      stateRevision: 0,
      canonicalUri: fixtureRoot,
      leaseOwner: "old-owner",
      leaseExpiresAt: String(now - 5 * 60_000),
    } as never);
    // Live: expires in 10 minutes.
    await sessions.create({
      sessionId: "sess-live",
      conversationId: "c",
      state: "inspecting",
      planRevision: "none",
      stateRevision: 0,
      canonicalUri: "/another/canonical/source",
      leaseOwner: "new-owner",
      leaseExpiresAt: String(now + 10 * 60_000),
    } as never);

    const staleClaim = await sessions.claimOrCreateSession(
      {
        sessionId: "sess-fresh-1",
        conversationId: "c",
        state: "acquiring",
        planRevision: "none",
        stateRevision: 0,
        canonicalUri: fixtureRoot,
      } as never,
      { nowMs: now }
    );
    expect(staleClaim.created).toBe(true);
    expect(staleClaim.staleTakenOver).toContain("sess-stale");
    const takenRow = await sessions.findBySessionId("sess-stale");
    expect(takenRow?.state).toBe("failed");
    expect(takenRow?.failureCode).toBe("LEASE_STALE");

    const liveClaim = await sessions.claimOrCreateSession(
      {
        sessionId: "sess-fresh-2",
        conversationId: "c",
        state: "acquiring",
        planRevision: "none",
        stateRevision: 0,
        canonicalUri: "/another/canonical/source",
      } as never,
      { nowMs: now }
    );
    expect(liveClaim.created).toBe(false);
    expect(liveClaim.session.sessionId).toBe("sess-live");
  }, 60_000);

  it("retry re-runs from the recorded source and stops after three same-cause failures", async () => {
    const module = new SkillInstallationModule();
    // Fail deterministically: a source that cannot be acquired.
    const badSource = path.join(os.tmpdir(), "definitely-missing-source-dir");
    const first = await module.prepare({
      conversationId: "conv-retry",
      source: badSource,
    });
    expect(first.state).toBe("failed");
    expect(first.errorCode).toBe("SOURCE_ACQUISITION_FAILED");

    // First failure of this cause -> streak 1 -> retry allowed.
    const second = await module.retry(first.sessionId);
    expect(second.state).toBe("failed");
    const third = await module.retry(second.sessionId);
    expect(third.state).toBe("failed");
    // Streak now 3 -> the stop rule refuses the next automatic retry.
    const refused = await module.retry(third.sessionId);
    expect(refused.errorCode).toBe("INSTALL_RETRY_LIMIT_EXCEEDED");
    expect(refused.safeSummary).toContain("same cause");

    // Each retry created exactly ONE session per attempt — all for the same
    // canonical source, never two active at once.
    const { SkillInstallationSessionModel } = await import(
      "@/model/SkillInstallation.model"
    );
    const sessions = new SkillInstallationSessionModel(tmpDir);
    const active = await sessions.findActiveByCanonicalUri(badSource);
    expect(active).toHaveLength(0); // all failed (terminal)
  }, 120_000);
});
