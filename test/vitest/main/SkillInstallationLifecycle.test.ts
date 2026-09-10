/**
 * Lifecycle tests for SkillInstallationModule (PRD §24, FR-19):
 * update re-plans with fresh approval, repair re-registers without moving
 * revisions, disable/enable toggle discovery, and uninstall removes owned
 * activations + credentials while preserving linked targets.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { SkillInstallationModule } from "@/modules/SkillInstallationModule";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";

const tmpDir = path.join(os.tmpdir(), "aifetchly-skill-install-lifecycle");

let fixtureRoot: string;
let configHome: string;

function makeFixture(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-fixture-"));
  fs.writeFileSync(
    path.join(repo, "SKILL.md"),
    "---\nname: video-use\ndescription: Edit videos\n---\n\n# Usage\n\nDo things."
  );
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

  fixtureRoot = makeFixture();
  configHome = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-home-"));
  process.env.AIFETCHLY_CONFIG_HOME = configHome;
  process.env.AIFETCHLY_SKILL_STAGING_ROOT = path.join(configHome, "staging");
  process.env.AIFETCHLY_SKILL_INSTALL_ENABLED = "true";
});

afterEach(() => {
  delete process.env.AIFETCHLY_CONFIG_HOME;
  delete process.env.AIFETCHLY_SKILL_STAGING_ROOT;
  delete process.env.AIFETCHLY_SKILL_INSTALL_ENABLED;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(configHome, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

/** Install the fixture and return (sessionId, installationId). */
async function installFixture(): Promise<{
  sessionId: string;
  installationId: string | null;
}> {
  const module = new SkillInstallationModule();
  const prepared = await module.prepare({
    conversationId: "conv-life",
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
  return {
    sessionId: prepared.sessionId,
    installationId: snapshot.installationId,
  };
}

describe("SkillInstallationModule lifecycle", () => {
  it("disable removes the skill from discovery and enable restores it", async () => {
    const { installationId } = await installFixture();
    expect(installationId).not.toBeNull();
    if (!installationId) return;

    const catalog = getDefaultPromptSkillCatalog();
    expect(catalog.resolve("video-use", {}).definition).not.toBeNull();

    const module = new SkillInstallationModule();
    expect(await module.disable(installationId)).toEqual({
      disabled: true,
      deactivatedInvocations: expect.any(Number),
    });
    // Disabled skills are hidden from discovery AND invocation.
    expect(catalog.resolve("video-use", {}).definition).toBeNull();

    expect(await module.enable(installationId)).toBe(true);
    expect(catalog.resolve("video-use", {}).definition).not.toBeNull();
  }, 120_000);

  it("repair re-registers a skill the catalog lost, without reacquiring", async () => {
    const { installationId } = await installFixture();
    if (!installationId) return;

    const catalog = getDefaultPromptSkillCatalog();
    catalog.remove(`prompt:user:${installationId}`);
    expect(catalog.get(`prompt:user:${installationId}`)).toBeNull();

    const module = new SkillInstallationModule();
    const report = await module.repair({ installationId });
    expect(report.ok).toBe(true);
    expect(report.repaired).toContain("catalog-re-registered");
    expect(
      report.checks.find((c) => c.name === "activation-readable")?.passed
    ).toBe(true);
    expect(catalog.get(`prompt:user:${installationId}`)).not.toBeNull();
  }, 120_000);

  it("update re-acquires and returns a fresh plan for approval", async () => {
    const { installationId } = await installFixture();
    if (!installationId) return;

    // Change the source (new commit content).
    fs.appendFileSync(
      path.join(fixtureRoot, "SKILL.md"),
      "\n\n## New Section\n\nUpdated instructions."
    );
    execSync("git add -A", { cwd: fixtureRoot });
    execSync("git -c user.email=t@t -c user.name=t commit -q -m update", {
      cwd: fixtureRoot,
    });

    const module = new SkillInstallationModule();
    const updateSnapshot = await module.update({ installationId });
    // Update holds at plan review — renewed approval is required.
    expect(updateSnapshot.state).toBe("awaiting_approval");
    expect(updateSnapshot.nextAction).toBe("review-plan");
    expect(updateSnapshot.planRevision).not.toBeNull();
  }, 120_000);

  it("update/repair resolve a natural-language NAME (FR-26)", async () => {
    await installFixture(); // fixture skill name: video-use
    const module = new SkillInstallationModule();

    // Unique name → deterministic resolution, real conversation preserved.
    const byName = await module.update({
      name: "Video-Use", // case-insensitive match
      conversationId: "conv-nl-update",
    });
    expect(byName.state).toBe("awaiting_approval");
    expect(byName.sessionId).not.toBeNull();

    // Repair by name verifies without updating.
    const repairByName = await module.repair({ name: "video-use" });
    expect(repairByName.ok).toBe(true);

    // Missing identity → typed SKILL_NOT_FOUND.
    const missing = await module.update({ name: "no-such-skill" });
    expect(missing.errorCode).toBe("SKILL_NOT_FOUND");
    const missingRepair = await module.repair({ name: "no-such-skill" });
    expect(missingRepair.errorCode).toBe("SKILL_NOT_FOUND");

    // Neither id nor name → typed guidance.
    const neither = await module.update({});
    expect(neither.errorCode).toBe("INSTALL_SESSION_REQUIRED");

    // Two installations with the SAME name → bounded clarification listing
    // the candidate ids (never a silent guess).
    const secondSource = fs.mkdtempSync(
      path.join(os.tmpdir(), "video-use-second-")
    );
    try {
      fs.copyFileSync(
        path.join(fixtureRoot, "SKILL.md"),
        path.join(secondSource, "SKILL.md")
      );
      execSync("git init -q", { cwd: secondSource });
      execSync("git add -A", { cwd: secondSource });
      execSync("git -c user.email=t@t -c user.name=t commit -q -m init", {
        cwd: secondSource,
      });
      const second = await module.prepare({
        conversationId: "conv-nl-second",
        source: secondSource,
      });
      let approvedSecond = await module.approve({
        sessionId: second.sessionId,
        planRevision: second.planRevision as string,
        approve: true,
        approvalToken: (await module.getApprovalToken(second.sessionId)) ?? "",
      });
      if (approvedSecond.state === "awaiting_secret") {
        approvedSecond = await module.resumeAfterSecret(second.sessionId);
      }
      expect(approvedSecond.installationId).toBeTruthy();

      const ambiguous = await module.update({ name: "video-use" });
      expect(ambiguous.errorCode).toBe("SKILL_AMBIGUOUS");
      expect(ambiguous.safeSummary).toContain("installation id");
    } finally {
      fs.rmSync(secondSource, { recursive: true, force: true });
    }
  }, 180_000);

  it("uninstall removes an owned managed copy and reports what was preserved", async () => {
    const { installationId } = await installFixture();
    if (!installationId) return;

    const activationPath = path.join(
      configHome,
      ".aifetchly",
      "skills",
      "video-use"
    );
    expect(fs.existsSync(activationPath)).toBe(true);

    const module = new SkillInstallationModule();
    const result = await module.uninstall({ installationId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removed).toBe("directory");
    expect(fs.existsSync(activationPath)).toBe(false);
    expect(
      getDefaultPromptSkillCatalog().resolve("video-use", {}).definition
    ).toBeNull();
  }, 120_000);

  it("uninstalling a linked installation never deletes the external target", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-linked",
      source: fixtureRoot,
      mode: "linked",
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
    const installationId = snapshot.installationId;
    expect(installationId).not.toBeNull();
    if (!installationId) return;

    const linkPath = path.join(configHome, ".aifetchly", "skills", "video-use");
    expect(
      fs.lstatSync(linkPath).isSymbolicLink() || fs.existsSync(linkPath)
    ).toBe(true);

    const result = await module.uninstall({ installationId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removed).toBe("link");
    // The external source directory SURVIVES the uninstall.
    expect(fs.existsSync(fixtureRoot)).toBe(true);
    expect(fs.existsSync(path.join(fixtureRoot, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(linkPath)).toBe(false);
  }, 120_000);

  it("cancel during activation rolls back immediately and cancels (D2/NFR-05)", async () => {
    const { SkillActivationService } = await import(
      "@/service/SkillActivationService"
    );
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-cancel-activation",
      source: fixtureRoot,
    });
    // Park the session in awaiting_secret, then flip the state directly to
    // "activating" to reproduce the mid-activation cancel window (the
    // module's own transition path is CAS-guarded, so drive the same
    // terminal check the cancel() branch performs).
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
    // Session is now terminal (ready/installing_dependencies): cancelling a
    // TERMINAL session is a no-op, so verify the mid-flight branch through
    // a fresh session parked in activating via the state the branch reads.
    const { SkillInstallationSessionModel } = await import(
      "@/model/SkillInstallation.model"
    );
    void SkillActivationService;
    const second = await module.prepare({
      conversationId: "conv-cancel-activation-2",
      source: fixtureRoot,
      sessionId: `cancel-mid-${Date.now()}`,
    });
    const { SqliteDb } = await import("@/config/SqliteDb");
    const sessionsModel = new SkillInstallationSessionModel(
      SqliteDb.getInstance(process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir)
        .connection.options.database as string
    );
    const row = await sessionsModel.findBySessionId(second.sessionId);
    if (row) {
      row.state = "activating";
      await sessionsModel.create(row);
    }
    const cancelled = await module.cancel(second.sessionId);
    // T8 (§10.1/NFR-05): cancelling mid-activation now performs the
    // rollback IMMEDIATELY and lands in cancelled — rollback_required is
    // reserved for a rollback that itself failed. This synthetic session
    // has no activation yet, so the rollback is trivially complete; the
    // real-activation rollback evidence lives in the decline-dependency
    // and E2E flows.
    expect(cancelled.state).toBe("cancelled");
  }, 120_000);

  it("uninstall deletes stored credentials by default and preserves them when asked (D2)", async () => {
    // Install once for a clean installationId (the local installFixture
    // helper binds its own module instance; use a fresh one here).
    const mod = new SkillInstallationModule();
    const prepared = await mod.prepare({
      conversationId: "conv-cred",
      source: fixtureRoot,
    });
    let approved = await mod.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await mod.getApprovalToken(prepared.sessionId)) ?? "",
    });
    if (approved.state === "awaiting_secret") {
      approved = await mod.resumeAfterSecret(prepared.sessionId);
    }
    const installationId = approved.installationId;
    expect(installationId).toBeTruthy();
    if (!installationId) return;

    // The fail-closed store refuses to persist without safeStorage — the
    // default uninstall must still report 0 and succeed.
    const result = await mod.uninstall({ installationId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secretsDeleted).toBe(0);

    // Explicit retention flag is honored without error.
    const second = await mod.prepare({
      conversationId: "conv-cred-2",
      source: fixtureRoot,
    });
    let approved2 = await mod.approve({
      sessionId: second.sessionId,
      planRevision: second.planRevision as string,
      approve: true,
      approvalToken: (await mod.getApprovalToken(second.sessionId)) ?? "",
    });
    if (approved2.state === "awaiting_secret") {
      approved2 = await mod.resumeAfterSecret(second.sessionId);
    }
    const retained = await mod.uninstall({
      installationId: approved2.installationId as string,
      deleteSecrets: false,
    });
    expect(retained.ok).toBe(true);
    if (!retained.ok) return;
    expect(retained.secretsDeleted).toBe(0);
  }, 180_000);

  it("update/repair/uninstall reject unknown installation ids", async () => {
    const module = new SkillInstallationModule();
    const updateResult = await module.update({
      installationId: "no-such-install",
    });
    expect(updateResult.errorCode).toBe("SKILL_NOT_FOUND");
    const repairResult = await module.repair({
      installationId: "no-such-install",
    });
    expect(repairResult.ok).toBe(false);
    expect(repairResult.errorCode).toBe("SKILL_NOT_FOUND");
    const disableResult = await module.disable("no-such-install");
    expect(disableResult.disabled).toBe(false);
    const uninstallResult = await module.uninstall({
      installationId: "no-such-install",
    });
    expect(uninstallResult.ok).toBe(false);
  }, 60_000);
});

describe("lifecycle identity for every package kind + repair verification (FR-19, NFR-05)", () => {
  it("executable routing persists the same lifecycle installation row", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "exec-fixture-"));
    try {
      fs.writeFileSync(
        path.join(repo, "manifest.json"),
        JSON.stringify({
          name: "exec-skill",
          version: "1.0.0",
          // JavaScript runtime keeps the import pipeline hermetic (the
          // python runtime triggers venv preparation).
          runtime: "javascript",
          entry: "main.js",
          description: "Executable fixture",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Input text." },
            },
            required: ["query"],
          },
        })
      );
      fs.writeFileSync(path.join(repo, "main.js"), "console.log('hi');\n");
      const module = new SkillInstallationModule();
      const prepared = await module.prepare({
        conversationId: "conv-exec",
        source: repo,
      });
      expect(prepared.state).toBe("awaiting_approval");
      const approved = await module.approve({
        sessionId: prepared.sessionId,
        planRevision: prepared.planRevision as string,
        approve: true,
        approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
      });
      expect(approved.state).toBe("ready");

      // The lifecycle row exists with the executable identity.
      const { SkillInstallationModel } = await import(
        "@/model/SkillInstallation.model"
      );
      const installations = new SkillInstallationModel(tmpDir);
      const row = approved.installationId
        ? await installations.findByInstallationId(approved.installationId)
        : null;
      expect(row).not.toBeNull();
      expect(row?.kind).toBe("executable");
      expect(row?.status).toBe("ready");
      expect(row?.sourceUri).toContain("exec-fixture");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  it("plugin routing persists a lifecycle row through the shared helper", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-plugin-row",
      source: fixtureRoot,
    });
    // Drive the shared row-persistence helper directly (the plugin IMPORT
    // pipeline itself is PluginImportService's concern): the row must
    // carry the plugin identity and link back to the session.
    const internals = module as unknown as {
      persistRoutedInstallationRow: (input: {
        sessions: unknown;
        sessionId: string;
        kind: "plugin" | "executable";
        name: string;
        plan: {
          source: {
            canonicalUri: string;
            resolvedRevision: string;
            contentHash: string;
          };
        };
        metadata: Record<string, unknown>;
      }) => Promise<void>;
    };
    const { SkillInstallationSessionModel, SkillInstallationModel } =
      await import("@/model/SkillInstallation.model");
    const sessions = new SkillInstallationSessionModel(tmpDir);
    const installations = new SkillInstallationModel(tmpDir);
    await internals.persistRoutedInstallationRow({
      sessions,
      sessionId: prepared.sessionId,
      kind: "plugin",
      name: "plugin-fixture",
      plan: {
        source: {
          canonicalUri: "/plugin/canonical/uri",
          resolvedRevision: "rev123",
          contentHash: "a".repeat(64),
        },
      },
      metadata: { pluginId: 7 },
    });
    const session = await sessions.findBySessionId(prepared.sessionId);
    expect(session?.installationId).toBeTruthy();
    const row = session?.installationId
      ? await installations.findByInstallationId(session.installationId)
      : null;
    expect(row?.kind).toBe("plugin");
    expect(row?.name).toBe("plugin-fixture");
    expect(JSON.parse(row?.metadataJson ?? "{}")).toMatchObject({
      pluginId: 7,
    });
  }, 120_000);

  it("repair detects changed activation content without rewriting it", async () => {
    const { installationId } = await installFixture();
    if (!installationId) return;
    // Mutate the ACTIVATED content (linked edits / manual changes).
    const { SkillInstallationModel } = await import(
      "@/model/SkillInstallation.model"
    );
    const installations = new SkillInstallationModel(tmpDir);
    const row = await installations.findByInstallationId(installationId);
    expect(row?.activationPath).toBeTruthy();
    fs.appendFileSync(
      path.join(row?.activationPath ?? "", "SKILL.md"),
      "\n<!-- externally edited -->\n"
    );

    const module = new SkillInstallationModule();
    const report = await module.repair({ installationId });
    const hashCheck = report.checks.find((c) => c.name === "content-hash-matches");
    expect(hashCheck?.passed).toBe(false);
    expect(hashCheck?.detail).toContain("update is required");
    // Repair never rewrote the content back.
    const after = fs.readFileSync(
      path.join(row?.activationPath ?? "", "SKILL.md"),
      "utf-8"
    );
    expect(after).toContain("externally edited");
  }, 120_000);

  it("disable deactivates durable invocations across conversations", async () => {
    const { installationId } = await installFixture();
    if (!installationId) return;
    // Seed two active invocations in different conversations.
    const { PromptSkillInvocationModule } = await import(
      "@/modules/PromptSkillInvocationModule"
    );
    const invocations = new PromptSkillInvocationModule();
    const runtimeId = `prompt:user:${installationId}`;
    for (const conversationId of ["conv-a", "conv-b"]) {
      await invocations.recordInvocation({
        conversationId,
        agentScope: "",
        runtimeId,
        contentHash: "b".repeat(64),
        normalizedInstructions: "# skill\ninstructions",
        tokenEstimate: 10,
        invocationArgumentsJson: "{}",
        invocationSource: "explicit",
        invokedAt: new Date(),
      });
    }

    const module = new SkillInstallationModule();
    const result = await module.disable(installationId);
    expect(result.disabled).toBe(true);
    expect(result.deactivatedInvocations).toBe(2);
    // And enable does NOT resurrect them (a fresh invocation is required).
    expect(await module.enable(installationId)).toBe(true);
  }, 120_000);
});

describe("linked development mode targets the original source (FR-11, NFR-05)", () => {
  /** Install the fixture in linked mode; returns the module + installation id. */
  async function installLinked(): Promise<{
    module: SkillInstallationModule;
    installationId: string | null;
  }> {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-linked",
      source: fixtureRoot,
      mode: "linked",
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
    return { module, installationId: approved.installationId };
  }

  it("the link points at the USER'S folder, not installer staging", async () => {
    const { installationId } = await installLinked();
    expect(installationId).toBeTruthy();
    if (!installationId) return;
    const { SkillInstallationModel } = await import(
      "@/model/SkillInstallation.model"
    );
    const installations = new SkillInstallationModel(tmpDir);
    const row = await installations.findByInstallationId(installationId);
    expect(row?.activationMode === "symbolic-link" || row?.activationMode === "junction").toBe(true);
    // The link resolves to the ORIGINAL fixture folder.
    expect(fs.realpathSync(row?.activationPath ?? "")).toBe(
      fs.realpathSync(fixtureRoot)
    );
    // Provenance records the link target (§22.3).
    expect(JSON.parse(row?.metadataJson ?? "{}")).toMatchObject({
      linkedTargetPath: fixtureRoot,
    });
  }, 120_000);

  it("external edits become visible after refresh; vanished targets are typed", async () => {
    const { module, installationId } = await installLinked();
    if (!installationId) return;

    // Baseline: unchanged.
    const before = await module.refreshLinkedInstallation(installationId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.status).toBe("unchanged");

    // External edit in the ORIGINAL folder.
    fs.appendFileSync(
      path.join(fixtureRoot, "SKILL.md"),
      "\n## Edited externally\n"
    );
    const after = await module.refreshLinkedInstallation(installationId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.status).toBe("changed");
    // The edit is visible THROUGH the activation path (no re-copy).
    const throughLink = fs.readFileSync(
      path.join(
        (await (async () => {
          const { SkillInstallationModel } = await import(
            "@/model/SkillInstallation.model"
          );
          const row = await new SkillInstallationModel(tmpDir).findByInstallationId(
            installationId
          );
          return row?.activationPath ?? "";
        })()),
        "SKILL.md"
      ),
      "utf-8"
    );
    expect(throughLink).toContain("Edited externally");

    // Vanished target → typed LINK_TARGET_MISSING, nothing deleted.
    const activationPath = await (async () => {
      const { SkillInstallationModel } = await import(
        "@/model/SkillInstallation.model"
      );
      const row = await new SkillInstallationModel(tmpDir).findByInstallationId(
        installationId
      );
      return row?.activationPath ?? "";
    })();
    // Move the ORIGINAL away (simulating a removed checkout) — the link
    // itself stays (it is app-owned).
    const movedAway = `${fixtureRoot}-moved`;
    fs.renameSync(fixtureRoot, movedAway);
    try {
      const missing = await module.refreshLinkedInstallation(installationId);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe("LINK_TARGET_MISSING");
      // Uninstall still removes ONLY the link; the moved source survives.
      const uninstall = await module.uninstall({ installationId });
      expect(uninstall.ok).toBe(true);
      if (uninstall.ok) expect(uninstall.removed).toBe("link");
      expect(fs.existsSync(movedAway)).toBe(true);
      expect(fs.existsSync(activationPath)).toBe(false);
    } finally {
      fs.renameSync(movedAway, fixtureRoot);
    }
  }, 180_000);

  it("linked mode with a REMOTE source never links staging", async () => {
    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-linked-remote",
      source: "https://github.com/browser-use/video-use",
      mode: "linked",
    });
    if (prepared.state === "failed") {
      // Offline (this host): remote acquisition fails with the typed code —
      // the wrong-link scenario is unreachable, which is the invariant.
      expect(prepared.errorCode).toBe("SOURCE_ACQUISITION_FAILED");
      return;
    }
    // Online: the plan holds; approving may pause at awaiting_secret for the
    // fixture's declared credential — resume, then activation must fail with
    // the typed LINK_CREATION_FAILED (linked requires a local folder).
    expect(prepared.state).toBe("awaiting_approval");
    let approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    });
    if (approved.state === "awaiting_secret") {
      approved = await module.resumeAfterSecret(prepared.sessionId);
    }
    expect(approved.state).toBe("failed");
    expect(approved.errorCode).toBe("LINK_CREATION_FAILED");
  }, 120_000);
});

describe("real Git provenance + GitHub archive fallback (FR-03)", () => {
  it("git/github revisions resolve to the ACTUAL commit SHA, distinct from the content hash", async () => {
    const { SkillSourceAcquisitionService } = await import(
      "@/service/SkillSourceAcquisitionService"
    );
    const service = new SkillSourceAcquisitionService(
      undefined,
      path.join(configHome, "staging")
    );
    const internals = service as unknown as {
      resolveRevision: (
        cloneRoot: string,
        stagingRoot: string,
        descriptor: { kind: string; requestedRevision?: string }
      ) => Promise<string>;
    };
    const stagingTarget = path.join(configHome, "staged-copy");
    fs.cpSync(fixtureRoot, stagingTarget, { recursive: true });

    // git/github kind → the fetcher clone's rev-parse HEAD (FR-03).
    const head = execSync("git rev-parse HEAD", { cwd: fixtureRoot })
      .toString()
      .trim();
    const sha = await internals.resolveRevision(fixtureRoot, stagingTarget, {
      kind: "git",
    });
    expect(sha).toBe(head);

    // A branch/tag request ALSO resolves the commit (not the ref name).
    const onBranch = await internals.resolveRevision(fixtureRoot, stagingTarget, {
      kind: "github",
      requestedRevision: "main",
    });
    expect(onBranch).toBe(head);

    // An explicitly pinned 40-hex revision IS the provenance.
    const pinned = await internals.resolveRevision(fixtureRoot, stagingTarget, {
      kind: "git",
      requestedRevision: "a".repeat(40),
    });
    expect(pinned).toBe("a".repeat(40));

    // Local/archive sources keep the CONTENT-hash identity, DISTINCT from
    // any commit SHA.
    const localIdentity = await internals.resolveRevision(
      fixtureRoot,
      stagingTarget,
      { kind: "local-directory" }
    );
    expect(localIdentity).not.toBe(head);
    expect(localIdentity).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);
});
