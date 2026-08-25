/**
 * Tests for SkillActivationService — managed copy, linked mode, uninstall
 * path safety, and rollback (design §11, NFR-05).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  SkillActivationService,
  OWNERSHIP_FILE,
  normalizeDirName,
} from "@/service/SkillActivationService";

let skillRoot: string;
let sourceRoot: string;

function writeSource(): string {
  sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-src-"));
  fs.writeFileSync(
    path.join(sourceRoot, "SKILL.md"),
    "---\nname: video-use\ndescription: Edit videos\n---\n\n# Usage\n\nDo things."
  );
  fs.mkdirSync(path.join(sourceRoot, "helpers"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "helpers", "cut.py"), "print('cut')");
  return sourceRoot;
}

beforeEach(() => {
  skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-activation-"));
});

afterEach(() => {
  fs.rmSync(skillRoot, { recursive: true, force: true });
});

describe("SkillActivationService — managed copy", () => {
  it("copies atomically with ownership metadata and verifies", async () => {
    const src = writeSource();
    const service = new SkillActivationService(skillRoot);
    const result = await service.activate({
      sourceRoot: src,
      skillName: "video-use",
      mode: "managed-copy",
      contentHash: "hash",
      installationId: "inst-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const activationPath = result.activationPath;
    expect(fs.existsSync(path.join(activationPath, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(activationPath, OWNERSHIP_FILE))).toBe(true);
    expect(fs.statSync(activationPath).isDirectory()).toBe(true);
    expect(service.verifyActivation(activationPath)).toBe(true);
  });

  it("refuses to replace a foreign (unowned) directory", async () => {
    const src = writeSource();
    const foreign = path.join(skillRoot, "video-use");
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, "README"), "user content");
    const service = new SkillActivationService(skillRoot);
    const result = await service.activate({
      sourceRoot: src,
      skillName: "video-use",
      mode: "managed-copy",
      contentHash: "hash",
      installationId: "inst-2",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ACTIVATION_COLLISION");
    // Foreign content untouched.
    expect(fs.existsSync(path.join(foreign, "README"))).toBe(true);
  });

  it("re-activating an owned directory backs up and replaces", async () => {
    const src = writeSource();
    const service = new SkillActivationService(skillRoot);
    const first = await service.activate({
      sourceRoot: src,
      skillName: "video-use",
      mode: "managed-copy",
      contentHash: "hash-1",
      installationId: "inst-3",
    });
    expect(first.ok).toBe(true);
    const second = await service.activate({
      sourceRoot: src,
      skillName: "video-use",
      mode: "managed-copy",
      contentHash: "hash-2",
      installationId: "inst-3",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.backupPath).not.toBeNull();
    // Old activation preserved for rollback until verification passes.
    expect(fs.existsSync(second.backupPath as string)).toBe(true);
  });
});

describe("SkillActivationService — uninstall safety (NFR-05)", () => {
  it("removes an owned managed copy", async () => {
    const src = writeSource();
    const service = new SkillActivationService(skillRoot);
    const activated = await service.activate({
      sourceRoot: src,
      skillName: "video-use",
      mode: "managed-copy",
      contentHash: "hash",
      installationId: "inst-4",
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    const removed = service.uninstall(activated.activationPath);
    expect(removed.ok).toBe(true);
    expect(fs.existsSync(activated.activationPath)).toBe(false);
  });

  it("uninstalling a linked skill removes ONLY the link, never the target", async () => {
    const src = fs.realpathSync(writeSource());
    const service = new SkillActivationService(skillRoot);
    const activated = await service.activate({
      sourceRoot: src,
      skillName: "linked-skill",
      mode: "linked",
      contentHash: "hash",
      installationId: "inst-5",
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(fs.lstatSync(activated.activationPath).isSymbolicLink()).toBe(
      process.platform !== "win32"
    );

    const removed = service.uninstall(activated.activationPath);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.removed).toBe("link");
    // The external source directory SURVIVES.
    expect(fs.existsSync(src)).toBe(true);
    expect(fs.existsSync(path.join(src, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(activated.activationPath)).toBe(false);
  });

  it("refuses to delete an unowned directory", () => {
    const foreign = path.join(skillRoot, "foreign-dir");
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, "data"), "user data");
    const service = new SkillActivationService(skillRoot);
    const removed = service.uninstall(foreign);
    expect(removed.ok).toBe(false);
    expect(fs.existsSync(path.join(foreign, "data"))).toBe(true);
  });
});

describe("SkillActivationService — rollback", () => {
  it("restores the previous activation", async () => {
    const src = writeSource();
    const service = new SkillActivationService(skillRoot);
    const first = await service.activate({
      sourceRoot: src,
      skillName: "video-use",
      mode: "managed-copy",
      contentHash: "hash-1",
      installationId: "inst-6",
    });
    expect(first.ok).toBe(true);
    const second = await service.activate({
      sourceRoot: src,
      skillName: "video-use",
      mode: "managed-copy",
      contentHash: "hash-2",
      installationId: "inst-6",
    });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;

    const rolled = service.rollback(
      second.activationPath,
      second.backupPath
    );
    expect(rolled.ok).toBe(true);
    expect(service.verifyActivation(first.activationPath)).toBe(true);
    expect(fs.existsSync(second.backupPath as string)).toBe(false);
  });
});

describe("normalizeDirName", () => {
  it("produces a safe directory slug", () => {
    expect(normalizeDirName("Video Use!")).toBe("video-use");
    expect(normalizeDirName("../etc/passwd")).toBe("etc-passwd");
  });
});
