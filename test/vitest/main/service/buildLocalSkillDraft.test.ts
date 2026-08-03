/**
 * SKL-01 (Phase 18 / Plan 01) — buildLocalSkillDraft pure-validator tests.
 *
 * buildLocalSkillDraft is the single-owner validator that turns a raw
 * `manifest.json` blob (plus source metadata + absolute skill dir + content
 * hash) into either a validated {@link LocalSkillDraft} or a non-fatal
 * `manifest-invalid` diagnostic. It DELEGATES the manifest schema check to
 * the EXISTING `SkillImportService.validateManifest` (the single schema owner
 * — name regex, semver, runtime, parameters type:object, permissions) and
 * adds the CFG-05 path-safety check on the `entry` field that
 * `validateManifest` does not itself perform (that check lives in
 * `importFromZip` for the zip path; the local-discovery path needs it here).
 *
 * Pure leaf: no fs / Electron / DB / SkillRegistry imports — only types +
 * the existing validator. Never throws; always returns a result discriminated
 * union. Mirrors the Phase-17 buildHookDefinition single-owner pattern.
 */
import { describe, expect, it } from "vitest";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import {
  buildLocalSkillDraft,
  type LocalSkillDraft,
} from "@/service/aifetchlyConfig/buildLocalSkillDraft";

/** Minimal valid manifest blob (matches the existing SkillManifest schema). */
function validManifest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: "my-scraper",
    version: "1.0.0",
    description: "Scrape my internal CRM for leads.",
    runtime: "javascript",
    entry: "handler.js",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    permissions: ["network"],
    ...overrides,
  };
}

const SOURCE_META = {
  source: "user" as const,
  sourceId: "user",
  relativePath: "skills/my-scraper/manifest.json",
};

const SKILL_DIR = "/home/user/.aifetchly/skills/my-scraper";
const HASH = "abc123hash";

describe("buildLocalSkillDraft (SKL-01 / pure validator)", () => {
  it("returns a LocalSkillDraft for a valid manifest", () => {
    const result = buildLocalSkillDraft(
      validManifest(),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const draft: LocalSkillDraft = result.draft;
    expect(draft.name).toBe("my-scraper");
    expect(draft.skillDir).toBe(SKILL_DIR);
    expect(draft.contentHash).toBe(HASH);
    // The validated manifest is preserved (reused SkillManifest type, not redefined).
    expect(draft.manifest.name).toBe("my-scraper");
    expect(draft.manifest.runtime).toBe("javascript");
    expect(draft.manifest.parameters.type).toBe("object");
  });

  it("rejects a manifest with an invalid name (delegates to validateManifest)", () => {
    const result = buildLocalSkillDraft(
      validManifest({ name: "Bad Name With Spaces" }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("manifest-invalid");
    expect(result.diagnostic.message).toMatch(/name/i);
  });

  it("rejects a manifest with a bad semver version", () => {
    const result = buildLocalSkillDraft(
      validManifest({ version: "not-a-version" }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("manifest-invalid");
    expect(result.diagnostic.message).toMatch(/version/i);
  });

  it("rejects a manifest whose runtime is outside the supported set", () => {
    const result = buildLocalSkillDraft(
      validManifest({ runtime: "ruby" }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("manifest-invalid");
    expect(result.diagnostic.message).toMatch(/runtime/i);
  });

  it("rejects a manifest whose parameters is not type:object", () => {
    const result = buildLocalSkillDraft(
      validManifest({ parameters: { type: "string" } }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("manifest-invalid");
  });

  it("rejects a manifest whose entry contains path traversal (CFG-05)", () => {
    const result = buildLocalSkillDraft(
      validManifest({ entry: "../../../etc/passwd" }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("manifest-invalid");
    expect(result.diagnostic.message).toMatch(/entry|traversal|path/i);
  });

  it("rejects a manifest whose entry is an absolute path (CFG-05)", () => {
    const result = buildLocalSkillDraft(
      validManifest({ entry: "/etc/passwd" }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("manifest-invalid");
  });

  it("rejects a non-object manifest blob", () => {
    const result = buildLocalSkillDraft(
      "not-an-object",
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("manifest-invalid");
  });

  it("preserves the sourceMeta + contentHash on the draft (workspace source)", () => {
    const workspaceMeta = {
      source: "workspace" as const,
      sourceId: "workspace:ws1",
      relativePath: "skills/foo/manifest.json",
    };
    const result = buildLocalSkillDraft(
      validManifest({ name: "foo" }),
      workspaceMeta,
      "/ws/.aifetchly/skills/foo",
      "deadbeef"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe("foo");
    expect(result.draft.skillDir).toBe("/ws/.aifetchly/skills/foo");
    expect(result.draft.contentHash).toBe("deadbeef");
  });

  it("carries the diagnostic source/sourceId/filePath from sourceMeta", () => {
    const result = buildLocalSkillDraft(
      validManifest({ name: "Bad" }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diag: AIFetchlyConfigDiagnostic = result.diagnostic;
    expect(diag.source).toBe("user");
    expect(diag.sourceId).toBe("user");
    expect(diag.filePath).toBe("skills/my-scraper/manifest.json");
    expect(diag.recoverable).toBe(true);
    expect(diag.severity).toBe("warning");
  });

  it("accepts a python-runtime manifest with a python block", () => {
    const result = buildLocalSkillDraft(
      validManifest({
        name: "py-skill",
        runtime: "python",
        entry: "handler.py",
        python: {
          version: "3.11",
          requirements_file: "requirements.txt",
        },
      }),
      SOURCE_META,
      SKILL_DIR,
      HASH
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest: SkillManifest = result.draft.manifest;
    expect(manifest.runtime).toBe("python");
    expect(manifest.python?.version).toBe("3.11");
  });
});
