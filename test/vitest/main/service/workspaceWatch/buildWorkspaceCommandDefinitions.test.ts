/**
 * CMD-06 (Phase 15 / Plan 02) — buildWorkspaceCommandDefinitions unit tests.
 *
 * The helper is the MAIN-PROCESS pure converter from Phase-14
 * WorkspaceCommandDraft[] -> validated SlashCommandDefinition[] + diagnostics,
 * reusing buildPromptCommandDefinition (single CMD-06 schema owner).
 *
 * Pure module: no fs/Electron/TypeORM imports (verified by the gate grep in
 * the plan). Never throws; never mutates input drafts.
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceCommandDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { buildWorkspaceCommandDefinitions } from "@/service/workspaceWatch/buildWorkspaceCommandDefinitions";

const META = {
  sourceId: "workspace:ws1",
  sourceLabel: "Workspace",
  requiresTrust: true,
} as const;

function makeDraft(overrides: Partial<WorkspaceCommandDraft> = {}): WorkspaceCommandDraft {
  return {
    id: "workspace:ws1:command:review",
    source: "workspace",
    sourceId: "workspace:ws1",
    relativePath: ".aifetchly/commands/review.md",
    frontmatter: {
      name: "review",
      description: "Review current changes",
      type: "prompt",
    },
    body: "Review the workspace changes.\n\nFocus on: $ARGUMENTS",
    contentHash: "deadbeef",
    ...overrides,
  };
}

describe("buildWorkspaceCommandDefinitions (CMD-06 / Plan 02)", () => {
  it("converts two valid drafts into two workspace SlashCommandDefinitions", () => {
    const result = buildWorkspaceCommandDefinitions(
      [
        makeDraft(),
        makeDraft({
          id: "workspace:ws1:command:ship",
          relativePath: ".aifetchly/commands/ship.md",
          frontmatter: { name: "ship", description: "Ship it", type: "prompt" },
          body: "Ship the branch.",
        }),
      ],
      META
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.definitions).toHaveLength(2);
    const [a, b] = result.definitions;
    expect(a).toMatchObject({
      id: "workspace:ws1:command:review",
      name: "review",
      source: "workspace",
      sourceId: "workspace:ws1",
      sourceLabel: "Workspace",
      type: "prompt",
      requiresTrust: true,
      enabled: true,
    });
    expect(b).toMatchObject({
      id: "workspace:ws1:command:ship",
      name: "ship",
      type: "prompt",
    });
  });

  it("partitions one valid + one invalid draft into one definition + one diagnostic", () => {
    const result = buildWorkspaceCommandDefinitions(
      [
        // Invalid: uppercase name fails COMMAND_NAME_REGEX.
        makeDraft({
          relativePath: ".aifetchly/commands/Bad.md",
          frontmatter: { name: "Bad", description: "Has desc", type: "prompt" },
          body: "body",
        }),
        makeDraft(),
      ],
      META
    );

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].name).toBe("review");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("command-name-invalid");
    expect(result.diagnostics[0].source).toBe("workspace");
    expect(result.diagnostics[0].sourceId).toBe("workspace:ws1");
    expect(result.diagnostics[0].filePath).toBe(".aifetchly/commands/Bad.md");
  });

  it("returns empty definitions + empty diagnostics for zero drafts", () => {
    const result = buildWorkspaceCommandDefinitions([], META);
    expect(result.definitions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("derives the definition id from the VALIDATED frontmatter name, not the filename", () => {
    // File named review.md but frontmatter name is "audit" -> id uses "audit".
    const result = buildWorkspaceCommandDefinitions(
      [
        makeDraft({
          relativePath: ".aifetchly/commands/review.md",
          frontmatter: { name: "audit", description: "Audit code", type: "prompt" },
          body: "Audit it.",
        }),
      ],
      META
    );

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].id).toBe("workspace:ws1:command:audit");
    expect(result.definitions[0].name).toBe("audit");
  });

  it("does NOT mutate the input drafts (defensive copies)", () => {
    const draft = makeDraft();
    const frontmatterSnapshot = { ...draft.frontmatter };
    buildWorkspaceCommandDefinitions([draft], META);

    expect(draft.frontmatter).toEqual(frontmatterSnapshot);
    expect(draft.body).toBe("Review the workspace changes.\n\nFocus on: $ARGUMENTS");
  });

  it("never throws on a malformed draft — surfaces a diagnostic instead", () => {
    // frontmatter with a non-string name (adversarial). buildPromptCommandDefinition
    // returns {ok:false}; the helper must forward it, not throw.
    const malformed = makeDraft({
      frontmatter: { name: 123 as unknown as string, description: "x", type: "prompt" },
    });
    const result = buildWorkspaceCommandDefinitions([malformed], META);
    expect(result.definitions).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
