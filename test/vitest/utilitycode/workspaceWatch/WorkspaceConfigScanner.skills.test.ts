/**
 * SKL-01 / D-WorkspaceSkills (Phase 18 / Plan 01 Task 2) — worker scanner
 * skill raw-draft tests.
 *
 * WorkspaceConfigScanner reads `<workspace>/.aifetchly/skills/<name>/manifest.json`
 * (one DIRECTORY per skill), JSON.parses it, and ships an opaque
 * WorkspaceSkillDraft[] carrying the unvalidated blob. NO validation, NO DB,
 * NO registry, NO Electron — the worker stays scan-only (WAT-02). Validation
 * happens main-side via buildWorkspaceSkillDefinitions.
 *
 * The scanner reads ONLY manifest.json per skill dir — it does NOT read the
 * entry .js/.py file content (the main process reads entry at registration
 * time per 18-RESEARCH Pattern 9 / Anti-Pattern).
 *
 * Runs under the utilitycode vitest config (the scanner is Electron-free).
 * Mirrors the Phase-17 hooks scanner test, adapted for skill DIRECTORIES.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import type { WorkspaceSkillDraft } from "@/entityTypes/aifetchlyConfigTypes";
import { WorkspaceConfigScanner } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";

/** Shape of the snapshot the scanner returns. */
interface ScanSnapshot {
  readonly skills: readonly unknown[];
  readonly files: readonly { kind: string; relativePath: string }[];
  readonly diagnostics: readonly { code: string; message: string }[];
}

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-ws-skills-"));
}

function writeSkillManifest(
  workspaceRoot: string,
  name: string,
  manifestObj: unknown,
  entryFile = "handler.js"
): string {
  const dotAifetchly = path.join(workspaceRoot, ".aifetchly");
  const skillDir = path.join(dotAifetchly, "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "manifest.json"),
    JSON.stringify(manifestObj),
    "utf8"
  );
  // Also write a placeholder entry file — the scanner must NOT read it.
  fs.writeFileSync(path.join(skillDir, entryFile), "// secret entry code\n", "utf8");
  return skillDir;
}

function skillDrafts(snap: ScanSnapshot): WorkspaceSkillDraft[] {
  return snap.skills as unknown as WorkspaceSkillDraft[];
}

function codes(snap: ScanSnapshot): string[] {
  return snap.diagnostics.map((d) => d.code);
}

async function scan(root: string): Promise<ScanSnapshot> {
  const scanner = new WorkspaceConfigScanner();
  return (await scanner.scan({
    workspaceId: "w1",
    workspaceRoot: root,
    includeRootAgentsFile: false,
  })) as unknown as ScanSnapshot;
}

describe("WorkspaceConfigScanner skill scan (SKL-01 / D-WorkspaceSkills / worker raw draft)", () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  it("ships a raw WorkspaceSkillDraft for a valid skill dir (NO validation in worker)", async () => {
    const root = makeRoot();
    roots.push(root);
    const manifest = {
      name: "ws-skill",
      version: "1.0.0",
      description: "workspace skill.",
      runtime: "javascript",
      entry: "handler.js",
      parameters: { type: "object", properties: {} },
    };
    const skillDir = writeSkillManifest(root, "ws-skill", manifest);

    const snap = await scan(root);
    const drafts = skillDrafts(snap);

    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft.name).toBe("ws-skill");
    expect(draft.sourceId).toBe("workspace:w1");
    expect(draft.source).toBe("workspace");
    expect(draft.id).toBe("workspace:w1:skill:ws-skill");
    expect(draft.relativePath).toBe(".aifetchly/skills/ws-skill/manifest.json");
    expect(draft.skillDir).toBe(skillDir);
    expect(draft.contentHash).toBe(
      crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
    );
    // The raw manifest blob is carried through UNVALIDATED (worker stays scan-only).
    expect(draft.rawManifest).toEqual(manifest);
  });

  it("does NOT read the entry file content (ships manifest.json ONLY)", async () => {
    const root = makeRoot();
    roots.push(root);
    writeSkillManifest(root, "no-entry-read", {
      name: "no-entry-read",
      version: "1.0.0",
      description: "x",
      runtime: "javascript",
      entry: "handler.js",
      parameters: { type: "object" },
    });

    const snap = await scan(root);
    const drafts = skillDrafts(snap);

    expect(drafts).toHaveLength(1);
    // The file snapshot records manifest.json with kind "skill". The entry
    // file (.js) is NOT recorded — the scanner reads manifest.json ONLY.
    const skillFiles = snap.files.filter((f) => f.kind === "skill");
    expect(skillFiles).toHaveLength(1);
    expect(skillFiles[0].relativePath).toBe(
      ".aifetchly/skills/no-entry-read/manifest.json"
    );
  });

  it("returns an empty skills array with NO diagnostic when skills/ is missing", async () => {
    const root = makeRoot();
    roots.push(root);
    fs.mkdirSync(path.join(root, ".aifetchly"), { recursive: true });

    const snap = await scan(root);

    expect(snap.skills).toHaveLength(0);
    expect(codes(snap)).toEqual([]);
  });

  it("carries an unvalidated blob for a malformed manifest (worker does NOT validate)", async () => {
    const root = makeRoot();
    roots.push(root);
    const skillDir = path.join(root, ".aifetchly", "skills", "broken");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "manifest.json"),
      "{ broken json",
      "utf8"
    );

    const snap = await scan(root);
    const drafts = skillDrafts(snap);

    // The worker does NOT decide validity — it ships the blob (rawManifest=null
    // on JSON.parse failure) and lets the main-side converter emit the
    // manifest-invalid diagnostic. NO diagnostic is emitted here.
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe("broken");
    expect(drafts[0].rawManifest).toBeNull();
    expect(codes(snap)).toEqual([]);
  });

  it("carries an unvalidated blob for a structurally-invalid manifest (worker does NOT validate)", async () => {
    const root = makeRoot();
    roots.push(root);
    // An invalid manifest (bad name) — the worker MUST still ship it raw;
    // validation is the main-side converter's job.
    writeSkillManifest(root, "whatever", {
      name: "BAD NAME WITH SPACES",
      runtime: "ruby",
    });

    const snap = await scan(root);
    const drafts = skillDrafts(snap);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].rawManifest).toEqual({
      name: "BAD NAME WITH SPACES",
      runtime: "ruby",
    });
    // NO diagnostic from the worker.
    expect(codes(snap)).toEqual([]);
  });

  it("skips non-directory entries inside skills/ (only directories are scanned)", async () => {
    const root = makeRoot();
    roots.push(root);
    const skillsDir = path.join(root, ".aifetchly", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "README.md"), "# not a skill\n", "utf8");

    const snap = await scan(root);

    expect(snap.skills).toHaveLength(0);
    expect(codes(snap)).toEqual([]);
  });

  it("emits a file-too-large diagnostic when manifest.json exceeds skillManifestBytes", async () => {
    const root = makeRoot();
    roots.push(root);
    const skillDir = path.join(root, ".aifetchly", "skills", "big");
    fs.mkdirSync(skillDir, { recursive: true });
    const padding = "y".repeat(AIFETCHLY_CONFIG_LIMITS.skillManifestBytes + 10);
    fs.writeFileSync(
      path.join(skillDir, "manifest.json"),
      JSON.stringify({ description: padding }),
      "utf8"
    );

    const snap = await scan(root);

    expect(snap.skills).toHaveLength(0);
    expect(codes(snap)).toContain("file-too-large");
  });

  it("ships multiple raw drafts, one per skill directory", async () => {
    const root = makeRoot();
    roots.push(root);
    writeSkillManifest(root, "alpha", { name: "alpha" });
    writeSkillManifest(root, "beta", { name: "beta" });

    const snap = await scan(root);
    const drafts = skillDrafts(snap);

    expect(drafts.map((d) => d.name).sort()).toEqual(["alpha", "beta"]);
    expect(drafts.every((d) => d.source === "workspace")).toBe(true);
  });
});
