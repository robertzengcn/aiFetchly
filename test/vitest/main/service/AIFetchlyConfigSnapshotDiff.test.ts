/**
 * CFG-06 — snapshot diff tests.
 *
 * computeSnapshotDiff indexes files by relativePath (comparing contentHash)
 * and derives the per-capability Changed booleans. prev=null is the initial
 * scan (everything added).
 */
import { describe, expect, it } from "vitest";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigFileSnapshot,
  AIFetchlyConfigSnapshot,
  AIFetchlyInstructionBlock,
} from "@/entityTypes/aifetchlyConfigTypes";
import { computeSnapshotDiff } from "@/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff";

function file(
  relativePath: string,
  contentHash: string,
  kind: AIFetchlyConfigFileSnapshot["kind"] = "instructions"
): AIFetchlyConfigFileSnapshot {
  return { relativePath, kind, mtimeMs: 1, sizeBytes: 1, contentHash };
}

function instr(
  id: string,
  contentHash: string,
  content = "x"
): AIFetchlyInstructionBlock {
  // (return type annotation uses the correct name; helper below returns the block)
  return {
    id,
    source: "user",
    sourceId: "user",
    label: "",
    relativePath: "AGENTS.md",
    content,
    contentHash,
    trusted: true,
  };
}

function diagnostic(code: string, message: string): AIFetchlyConfigDiagnostic {
  return {
    severity: "warning",
    source: "user",
    sourceId: "user",
    filePath: "settings.json",
    code,
    message,
    recoverable: true,
  };
}

function makeSnapshot(
  overrides: Partial<AIFetchlyConfigSnapshot> = {}
): AIFetchlyConfigSnapshot {
  return {
    source: "user",
    sourceId: "user",
    rootPath: "/tmp/fake",
    version: 1,
    files: [],
    instructions: [],
    commands: [],
    agents: [],
    hooks: [],
    skills: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("computeSnapshotDiff (CFG-06)", () => {
  it("prev=null: every file is added", () => {
    const next = makeSnapshot({
      files: [file("AGENTS.md", "h1")],
    });
    const diff = computeSnapshotDiff(null, next);
    expect(diff.added).toEqual(["AGENTS.md"]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("one added file with an instruction block sets instructionsChanged=true", () => {
    const next = makeSnapshot({
      files: [file("AGENTS.md", "h1")],
      instructions: [instr("user:instructions:AGENTS.md", "h1")],
    });
    const diff = computeSnapshotDiff(null, next);
    expect(diff.added).toEqual(["AGENTS.md"]);
    expect(diff.instructionsChanged).toBe(true);
  });

  it("content-hash change on an existing path is reported in changed", () => {
    const prev = makeSnapshot({
      files: [file("AGENTS.md", "h1")],
      instructions: [instr("user:instructions:AGENTS.md", "h1", "a")],
    });
    const next = makeSnapshot({
      files: [file("AGENTS.md", "h2")],
      instructions: [instr("user:instructions:AGENTS.md", "h2", "b")],
    });
    const diff = computeSnapshotDiff(prev, next);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual(["AGENTS.md"]);
    expect(diff.removed).toEqual([]);
    expect(diff.instructionsChanged).toBe(true);
  });

  it("deleted path is reported in removed", () => {
    const prev = makeSnapshot({
      files: [file("AGENTS.md", "h1")],
      instructions: [instr("user:instructions:AGENTS.md", "h1")],
    });
    const next = makeSnapshot();
    const diff = computeSnapshotDiff(prev, next);
    expect(diff.removed).toEqual(["AGENTS.md"]);
    expect(diff.instructionsChanged).toBe(true);
  });

  it("identical snapshots produce no changes", () => {
    const snap = makeSnapshot({
      files: [file("AGENTS.md", "h1")],
      instructions: [instr("user:instructions:AGENTS.md", "h1")],
      diagnostics: [diagnostic("settings-json-invalid", "bad")],
    });
    const diff = computeSnapshotDiff(snap, snap);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.instructionsChanged).toBe(false);
    expect(diff.diagnosticsChanged).toBe(false);
    expect(diff.commandsChanged).toBe(false);
    expect(diff.agentsChanged).toBe(false);
    expect(diff.hooksChanged).toBe(false);
    expect(diff.skillsChanged).toBe(false);
  });

  it("added and removed paths are sorted for deterministic output", () => {
    const prev = makeSnapshot({
      files: [
        file("commands/c.md", "x", "command"),
        file("commands/a.md", "x", "command"),
      ],
    });
    const next = makeSnapshot({
      files: [
        file("commands/b.md", "x", "command"),
        file("commands/a.md", "x", "command"),
      ],
    });
    const diff = computeSnapshotDiff(prev, next);
    expect(diff.added).toEqual(["commands/b.md"]);
    expect(diff.removed).toEqual(["commands/c.md"]);
  });

  it("diagnosticsChanged detects new diagnostics", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      diagnostics: [diagnostic("settings-json-invalid", "bad")],
    });
    expect(computeSnapshotDiff(prev, next).diagnosticsChanged).toBe(true);
    expect(computeSnapshotDiff(next, next).diagnosticsChanged).toBe(false);
  });

  it("diagnosticsChanged detects changed diagnostic messages", () => {
    const prev = makeSnapshot({
      diagnostics: [diagnostic("settings-json-invalid", "old")],
    });
    const next = makeSnapshot({
      diagnostics: [diagnostic("settings-json-invalid", "new")],
    });
    expect(computeSnapshotDiff(prev, next).diagnosticsChanged).toBe(true);
  });

  it("commandsChanged flips when the command id set changes (forward-compat for phase 15)", () => {
    // Phase 13 snapshots always have empty commands arrays, so this is a
    // forward-compat check: the diff must detect id-set changes once Plan 02
    // starts populating commands.
    const prev = makeSnapshot({
      commands: [{ id: "user:command:review" }],
    });
    const next = makeSnapshot({
      commands: [{ id: "user:command:review" }, { id: "user:command:lead" }],
    });
    expect(computeSnapshotDiff(prev, next).commandsChanged).toBe(true);
    expect(computeSnapshotDiff(next, next).commandsChanged).toBe(false);
  });
});
