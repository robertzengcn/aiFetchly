/**
 * SKL-01 (Phase 18 / Plan 01 Task 3) — LocalSkillSourceAdapter tests.
 *
 * LocalSkillSourceAdapter gives SkillRegistry source-replacement semantics
 * (unregister-then-register) WITHOUT rewriting SkillRegistry (which has NO
 * replaceSource). It tracks sourceId -> Set<skillName> and reconciles via
 * SkillImportService.registerImportedSkill + SkillRegistry.unregisterSkill.
 *
 * Covered behaviors:
 *   - replaceSource(sourceId, drafts) registers the new draft set.
 *   - A rescan that drops a skill unregisters the old name (no stale entries).
 *   - A draft whose name collides with an already-registered (built-in) skill
 *     emits a manifest-invalid diagnostic and does NOT throw (built-in always
 *     wins; T-spoof-builtin / T-18-02).
 *   - removeSource clears the source's skills (replaceSource(sourceId, [])).
 *
 * Uses the REAL SkillImportService.registerImportedSkill + REAL SkillRegistry
 * with real tmp skill dirs — an integration test proving the full wiring.
 * SkillRegistry is a module singleton; tests clean up via afterEach.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { LocalSkillDraft } from "@/service/aifetchlyConfig/buildLocalSkillDraft";
import { buildLocalSkillDraft } from "@/service/aifetchlyConfig/buildLocalSkillDraft";
import { LocalSkillSourceAdapter } from "@/service/LocalSkillSourceAdapter";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillImportService } from "@/service/SkillImportService";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-adapter-"));
}

/** Write a real skill dir with manifest.json + entry .js and build a LocalSkillDraft. */
function makeDraft(
  root: string,
  name: string,
  entryContent = "// handler\nmodule.exports = async () => ({ ok: true });\n"
): LocalSkillDraft {
  const skillDir = path.join(root, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const manifest = {
    name,
    version: "1.0.0",
    description: `Test skill ${name}.`,
    runtime: "javascript",
    entry: "handler.js",
    parameters: { type: "object", properties: {} },
  };
  fs.writeFileSync(
    path.join(skillDir, "manifest.json"),
    JSON.stringify(manifest),
    "utf8"
  );
  fs.writeFileSync(path.join(skillDir, "handler.js"), entryContent, "utf8");

  const result = buildLocalSkillDraft(
    manifest,
    {
      source: "user",
      sourceId: "user",
      relativePath: `skills/${name}/manifest.json`,
    },
    skillDir,
    "fakehash"
  );
  if (!result.ok)
    throw new Error(`makeDraft failed: ${result.diagnostic.message}`);
  return result.draft;
}

/** Unregister every tracked test skill from the singleton SkillRegistry. */
function cleanup(names: readonly string[]): void {
  for (const n of names) {
    try {
      SkillRegistry.unregisterSkill(n);
    } catch {
      /* already gone */
    }
  }
}

describe("LocalSkillSourceAdapter (SKL-01 / source reconciliation)", () => {
  const roots: string[] = [];
  const tracked: string[] = [];

  beforeAll(() => {
    // Ensure registerImportedSkill is reachable (Task 3 exports it).
    expect(typeof SkillImportService.registerImportedSkill).toBe("function");
  });

  afterEach(() => {
    cleanup(tracked.splice(0));
  });

  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  it("replaceSource registers a new draft set via SkillImportService.registerImportedSkill", () => {
    const root = makeTmpDir();
    roots.push(root);
    const draft = makeDraft(root, "adapter-alpha");
    tracked.push(draft.name);
    const adapter = new LocalSkillSourceAdapter();

    const diagnostics = adapter.replaceSource("user", [draft]);

    expect(diagnostics).toEqual([]);
    expect(SkillRegistry.isRegistered("adapter-alpha")).toBe(true);
  });

  it("a rescan that drops a skill unregisters the old name (no stale entries)", () => {
    const root = makeTmpDir();
    roots.push(root);
    const alpha = makeDraft(root, "adapter-rescan-alpha");
    const beta = makeDraft(root, "adapter-rescan-beta");
    tracked.push(alpha.name, beta.name);
    const adapter = new LocalSkillSourceAdapter();

    // First scan: both skills registered.
    adapter.replaceSource("user", [alpha, beta]);
    expect(SkillRegistry.isRegistered("adapter-rescan-alpha")).toBe(true);
    expect(SkillRegistry.isRegistered("adapter-rescan-beta")).toBe(true);

    // Rescan: only beta remains — alpha must be unregistered.
    adapter.replaceSource("user", [beta]);
    expect(SkillRegistry.isRegistered("adapter-rescan-alpha")).toBe(false);
    expect(SkillRegistry.isRegistered("adapter-rescan-beta")).toBe(true);
  });

  it("replaceSource(sourceId, []) clears the source's skills", () => {
    const root = makeTmpDir();
    roots.push(root);
    const draft = makeDraft(root, "adapter-clear");
    tracked.push(draft.name);
    const adapter = new LocalSkillSourceAdapter();

    adapter.replaceSource("user", [draft]);
    expect(SkillRegistry.isRegistered("adapter-clear")).toBe(true);

    adapter.replaceSource("user", []);
    expect(SkillRegistry.isRegistered("adapter-clear")).toBe(false);
  });

  it("a draft whose name collides with a built-in skill emits manifest-invalid and does NOT throw (T-spoof-builtin)", () => {
    // Pre-register a skill that simulates a "built-in" name collision target.
    // Use a real built-in if present, else seed one.
    const collideName = "adapter-collide-target";
    SkillRegistry.registerSkill({
      name: collideName,
      description: "Pre-existing built-in",
      parameters: { type: "object", properties: {} },
      tier: "sandboxed",
      permissionCategory: "pure",
      requiresConfirmation: false,
      source: "built-in",
      execute: async () => ({ success: true, result: { ok: true } }),
    });
    tracked.push(collideName);

    const root = makeTmpDir();
    roots.push(root);
    // Draft with the SAME name as the pre-registered skill.
    const draft = makeDraft(root, collideName);
    const adapter = new LocalSkillSourceAdapter();

    // Must NOT throw — the adapter catches the registerSkill collision.
    const diagnostics = adapter.replaceSource("user", [draft]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("manifest-invalid");
    expect(diagnostics[0].message).toMatch(/collid|already registered/i);
    // The built-in remains registered (built-in always wins).
    expect(SkillRegistry.isRegistered(collideName)).toBe(true);
  });

  it("tracks source names independently per sourceId (global + workspace)", () => {
    const root = makeTmpDir();
    roots.push(root);
    const userDraft = makeDraft(root, "adapter-user-skill");
    const wsDraft = makeDraft(root, "adapter-ws-skill");
    tracked.push(userDraft.name, wsDraft.name);
    const adapter = new LocalSkillSourceAdapter();

    adapter.replaceSource("user", [userDraft]);
    adapter.replaceSource("workspace:w1", [wsDraft]);

    expect(SkillRegistry.isRegistered("adapter-user-skill")).toBe(true);
    expect(SkillRegistry.isRegistered("adapter-ws-skill")).toBe(true);

    // Removing the workspace source does NOT touch the user source.
    adapter.replaceSource("workspace:w1", []);
    expect(SkillRegistry.isRegistered("adapter-user-skill")).toBe(true);
    expect(SkillRegistry.isRegistered("adapter-ws-skill")).toBe(false);
  });

  it("returns an empty diagnostics array for an empty draft set on a fresh source", () => {
    const adapter = new LocalSkillSourceAdapter();
    const diagnostics = adapter.replaceSource("user", []);
    expect(diagnostics).toEqual([]);
  });
});
