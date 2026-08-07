/**
 * SKL-01 (Phase 18 / Plan 01 Task 3) — AIFetchlyRuntimeRegistrySync skill-wiring tests.
 *
 * Verifies that:
 *   - applyWorkspaceSnapshot applies the `skills: trust.skills ? snapshot.skills : []`
 *     trust filter (untrusted workspace skills dropped BEFORE mutation — TRS-01 /
 *     T-untrusted-workspace / T-18-04).
 *   - applySnapshot reconciles skills via LocalSkillSourceAdapter.replaceSource
 *     for both the global (source 'user') path and the workspace (raw draft →
 *     converted) path.
 *   - removeSource clears the source's skills.
 *   - A rescan with a changed skill set reconciles correctly.
 *
 * Uses the REAL LocalSkillSourceAdapter + REAL SkillRegistry with real tmp skill
 * dirs so the end-to-end wiring is exercised. Mirrors the Phase-17
 * AIFetchlyRuntimeRegistrySync.hooks.test.ts sibling.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type {
  AIFetchlyConfigSnapshot,
  AIFetchlySourceTrust,
  WorkspaceSkillDraft,
} from "@/entityTypes/aifetchlyConfigTypes";
import type { LocalSkillDraft } from "@/service/aifetchlyConfig/buildLocalSkillDraft";
import { buildLocalSkillDraft } from "@/service/aifetchlyConfig/buildLocalSkillDraft";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import { AIFetchlyContextStore } from "@/service/aifetchlyConfig/AIFetchlyContextStore";
import { AIFetchlyRuntimeRegistrySync } from "@/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync";
import { LocalSkillSourceAdapter } from "@/service/LocalSkillSourceAdapter";
import { SkillRegistry } from "@/config/skillsRegistry";

const ALL_FALSE: AIFetchlySourceTrust = {
  instructions: false,
  commands: false,
  agents: false,
  hooks: false,
  skills: false,
};
const SKILLS_TRUE: AIFetchlySourceTrust = { ...ALL_FALSE, skills: true };

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-sync-skills-"));
}

/** Write a real skill dir and build a validated LocalSkillDraft (source 'user'). */
function makeUserDraft(root: string, name: string): LocalSkillDraft {
  const skillDir = path.join(root, "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  const manifest = {
    name,
    version: "1.0.0",
    description: `Sync skill ${name}.`,
    runtime: "javascript",
    entry: "handler.js",
    parameters: { type: "object", properties: {} },
  };
  fs.writeFileSync(path.join(skillDir, "manifest.json"), JSON.stringify(manifest), "utf8");
  fs.writeFileSync(path.join(skillDir, "handler.js"), "// x\n", "utf8");
  const result = buildLocalSkillDraft(
    manifest,
    { source: "user", sourceId: "user", relativePath: `skills/${name}/manifest.json` },
    skillDir,
    "hash"
  );
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.draft;
}

/** Build a raw workspace skill draft (worker shape, unvalidated). */
function makeWsDraft(root: string, name: string): WorkspaceSkillDraft {
  const skillDir = path.join(root, ".aifetchly", "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  const manifest = {
    name,
    version: "1.0.0",
    description: `WS skill ${name}.`,
    runtime: "javascript",
    entry: "handler.js",
    parameters: { type: "object", properties: {} },
  };
  fs.writeFileSync(path.join(skillDir, "manifest.json"), JSON.stringify(manifest), "utf8");
  fs.writeFileSync(path.join(skillDir, "handler.js"), "// x\n", "utf8");
  return {
    id: `workspace:w1:skill:${name}`,
    source: "workspace",
    sourceId: "workspace:w1",
    name,
    relativePath: `.aifetchly/skills/${name}/manifest.json`,
    skillDir,
    rawManifest: manifest,
    contentHash: "hash",
  };
}

function buildGlobalSnapshot(skills: readonly LocalSkillDraft[]): AIFetchlyConfigSnapshot {
  return {
    source: "user",
    sourceId: "user",
    rootPath: "/tmp/user",
    version: 1,
    files: [],
    instructions: [],
    commands: [],
    agents: [],
    hooks: [],
    skills: skills as readonly unknown[],
    diagnostics: [],
  };
}

function buildWorkspaceSnapshot(
  skills: readonly WorkspaceSkillDraft[],
  workspaceRoot: string
): AIFetchlyConfigSnapshot {
  return {
    source: "workspace",
    sourceId: "workspace:w1",
    rootPath: workspaceRoot,
    workspaceId: "w1",
    version: 1,
    files: [],
    instructions: [],
    commands: [],
    agents: [],
    hooks: [],
    skills: skills as readonly unknown[],
    diagnostics: [],
  };
}

describe("AIFetchlyRuntimeRegistrySync skills wiring (SKL-01)", () => {
  const roots: string[] = [];
  const tracked: string[] = [];

  afterEach(() => {
    for (const n of tracked) {
      try {
        SkillRegistry.unregisterSkill(n);
      } catch {
        /* gone */
      }
    }
    tracked.length = 0;
  });

  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  function makeSync(): AIFetchlyRuntimeRegistrySync {
    return new AIFetchlyRuntimeRegistrySync(
      new CommandRegistry(),
      new AIFetchlyContextStore(),
      new AgentDefinitionRegistryImpl()
    );
  }

  it("applySnapshot registers global (source 'user') skills through the adapter", () => {
    const root = makeTmpDir();
    roots.push(root);
    const draft = makeUserDraft(root, "sync-global-skill");
    tracked.push(draft.name);
    const sync = makeSync();

    const result = sync.applySnapshot(buildGlobalSnapshot([draft]));

    expect(SkillRegistry.isRegistered("sync-global-skill")).toBe(true);
    expect(result.skillsChanged).toBe(true);
  });

  it("applyWorkspaceSnapshot with trust.skills=false drops workspace skills BEFORE mutation (T-untrusted-workspace)", () => {
    const root = makeTmpDir();
    roots.push(root);
    const wsDraft = makeWsDraft(root, "sync-untrusted-skill");
    tracked.push(wsDraft.name);
    const snap = buildWorkspaceSnapshot([wsDraft], root);
    const sync = makeSync();

    sync.applyWorkspaceSnapshot(snap, ALL_FALSE);

    // Untrusted workspace skill must NOT reach the registry.
    expect(SkillRegistry.isRegistered("sync-untrusted-skill")).toBe(false);
  });

  it("applyWorkspaceSnapshot with trust.skills=true converts workspace drafts and registers them", () => {
    const root = makeTmpDir();
    roots.push(root);
    const wsDraft = makeWsDraft(root, "sync-trusted-skill");
    tracked.push(wsDraft.name);
    const snap = buildWorkspaceSnapshot([wsDraft], root);
    const sync = makeSync();

    sync.applyWorkspaceSnapshot(snap, SKILLS_TRUE);

    expect(SkillRegistry.isRegistered("sync-trusted-skill")).toBe(true);
  });

  it("removeSource clears the source's skills via the adapter", () => {
    const root = makeTmpDir();
    roots.push(root);
    const draft = makeUserDraft(root, "sync-remove-skill");
    tracked.push(draft.name);
    const sync = makeSync();

    sync.applySnapshot(buildGlobalSnapshot([draft]));
    expect(SkillRegistry.isRegistered("sync-remove-skill")).toBe(true);

    sync.removeSource("user");
    expect(SkillRegistry.isRegistered("sync-remove-skill")).toBe(false);
  });

  it("a rescan that drops a skill reconciles via the adapter (no stale entries)", () => {
    const root = makeTmpDir();
    roots.push(root);
    const alpha = makeUserDraft(root, "sync-rescan-alpha");
    const beta = makeUserDraft(root, "sync-rescan-beta");
    tracked.push(alpha.name, beta.name);
    const sync = makeSync();

    sync.applySnapshot(buildGlobalSnapshot([alpha, beta]));
    expect(SkillRegistry.isRegistered("sync-rescan-alpha")).toBe(true);

    // Rescan: only beta remains.
    sync.applySnapshot(buildGlobalSnapshot([beta]));
    expect(SkillRegistry.isRegistered("sync-rescan-alpha")).toBe(false);
    expect(SkillRegistry.isRegistered("sync-rescan-beta")).toBe(true);
  });

  it("applySnapshot with empty skills reports skillsChanged=false", () => {
    const sync = makeSync();
    const result = sync.applySnapshot(buildGlobalSnapshot([]));
    expect(result.skillsChanged).toBe(false);
  });
});
