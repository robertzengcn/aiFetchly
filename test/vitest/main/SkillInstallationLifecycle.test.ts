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
    expect(await module.disable(installationId)).toBe(true);
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
    const report = await module.repair(installationId);
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
    execSync('git -c user.email=t@t -c user.name=t commit -q -m update', {
      cwd: fixtureRoot,
    });

    const module = new SkillInstallationModule();
    const updateSnapshot = await module.update(installationId);
    // Update holds at plan review — renewed approval is required.
    expect(updateSnapshot.state).toBe("awaiting_approval");
    expect(updateSnapshot.nextAction).toBe("review-plan");
    expect(updateSnapshot.planRevision).not.toBeNull();
  }, 120_000);

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
    expect(getDefaultPromptSkillCatalog().resolve("video-use", {}).definition)
      .toBeNull();
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
    });
    if (snapshot.state === "awaiting_secret") {
      snapshot = await module.resumeAfterSecret(prepared.sessionId);
    }
    const installationId = snapshot.installationId;
    expect(installationId).not.toBeNull();
    if (!installationId) return;

    const linkPath = path.join(
      configHome,
      ".aifetchly",
      "skills",
      "video-use"
    );
    expect(fs.lstatSync(linkPath).isSymbolicLink() || fs.existsSync(linkPath)).toBe(true);

    const result = await module.uninstall({ installationId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removed).toBe("link");
    // The external source directory SURVIVES the uninstall.
    expect(fs.existsSync(fixtureRoot)).toBe(true);
    expect(fs.existsSync(path.join(fixtureRoot, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(linkPath)).toBe(false);
  }, 120_000);

  it("update/repair/uninstall reject unknown installation ids", async () => {
    const module = new SkillInstallationModule();
    const updateResult = await module.update("no-such-install");
    expect(updateResult.errorCode).toBe("INSTALL_SESSION_REQUIRED");
    const repairResult = await module.repair("no-such-install");
    expect(repairResult.ok).toBe(false);
    const disableResult = await module.disable("no-such-install");
    expect(disableResult).toBe(false);
    const uninstallResult = await module.uninstall({
      installationId: "no-such-install",
    });
    expect(uninstallResult.ok).toBe(false);
  }, 60_000);
});
