/**
 * AGT-02 (Phase 16 / Plan 02) — buildWorkspaceAgentDefinitions unit tests.
 *
 * The helper is the MAIN-PROCESS pure converter from the Phase-16 worker's
 * raw WorkspaceAgentDraft[] -> validated AgentDefinitionView[] + diagnostics,
 * reusing buildAgentDefinition (single AGT-02 schema owner from Plan 01) and
 * emitting non-fatal agent-tool-invalid warnings via detectUnknownTools.
 *
 * Pure module: no fs/Electron/TypeORM imports. Never throws; never mutates.
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceAgentDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { buildWorkspaceAgentDefinitions } from "@/service/workspaceWatch/buildWorkspaceAgentDefinitions";

const WORKSPACE_ID = "ws1";
const KNOWN_TOOLS = new Set<string>([
  "scrape_urls_from_search_engine",
  "knowledge_library_search",
]);

function makeDraft(overrides: Partial<WorkspaceAgentDraft> = {}): WorkspaceAgentDraft {
  return {
    id: "workspace:ws1:agent:lead-researcher",
    source: "workspace",
    sourceId: "workspace:ws1",
    relativePath: ".aifetchly/agents/lead-researcher.md",
    frontmatter: {
      name: "lead-researcher",
      description: "Gathers public business context for a lead.",
      tools: ["scrape_urls_from_search_engine"],
    },
    body: "You are a lead researcher. Return JSON.\n",
    contentHash: "deadbeef",
    ...overrides,
  };
}

describe("buildWorkspaceAgentDefinitions (AGT-02 / Plan 02)", () => {
  it("converts a valid draft into a workspace:<id>:agent:<name> AgentDefinitionView", () => {
    const result = buildWorkspaceAgentDefinitions(
      [makeDraft()],
      WORKSPACE_ID,
      KNOWN_TOOLS
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.definitions).toHaveLength(1);
    const def = result.definitions[0];
    expect(def.id).toBe("workspace:ws1:agent:lead-researcher");
    expect(def.name).toBe("lead-researcher");
    expect(def.mode).toBe("specialist");
    expect(def.allowedTools).toEqual(["scrape_urls_from_search_engine"]);
    expect(def.systemPrompt).toContain("lead researcher");
    expect(def.status).toBe("active");
  });

  it("converts two valid drafts into two workspace-scoped definitions", () => {
    const result = buildWorkspaceAgentDefinitions(
      [
        makeDraft(),
        makeDraft({
          id: "workspace:ws1:agent:outreach-writer",
          relativePath: ".aifetchly/agents/outreach-writer.md",
          frontmatter: {
            name: "outreach-writer",
            description: "Writes outreach messages.",
          },
          body: "You write outreach copy.",
        }),
      ],
      WORKSPACE_ID,
      KNOWN_TOOLS
    );

    expect(result.definitions).toHaveLength(2);
    const ids = result.definitions.map((d) => d.id).sort();
    expect(ids).toEqual([
      "workspace:ws1:agent:lead-researcher",
      "workspace:ws1:agent:outreach-writer",
    ]);
  });

  it("excludes an invalid-name draft and emits an agent-name-invalid diagnostic", () => {
    const result = buildWorkspaceAgentDefinitions(
      [
        makeDraft({
          relativePath: ".aifetchly/agents/Bad.md",
          frontmatter: { name: "Bad", description: "Has desc" },
          body: "body",
        }),
      ],
      WORKSPACE_ID,
      KNOWN_TOOLS
    );

    expect(result.definitions).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("agent-name-invalid");
    expect(result.diagnostics[0].source).toBe("workspace");
    expect(result.diagnostics[0].sourceId).toBe("workspace:ws1");
    expect(result.diagnostics[0].filePath).toBe(".aifetchly/agents/Bad.md");
  });

  it("still includes a draft with an unknown tool AND emits an agent-tool-invalid diagnostic (D-ToolDiagnostic non-fatal)", () => {
    const result = buildWorkspaceAgentDefinitions(
      [
        makeDraft({
          id: "workspace:ws1:agent:mystery",
          relativePath: ".aifetchly/agents/mystery.md",
          frontmatter: {
            name: "mystery",
            description: "Uses an unknown tool.",
            tools: ["non_existent_tool_xyz"],
          },
          body: "body",
        }),
      ],
      WORKSPACE_ID,
      KNOWN_TOOLS
    );

    // The agent IS still converted (non-fatal).
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].id).toBe("workspace:ws1:agent:mystery");
    // And a warning is emitted.
    const toolWarnings = result.diagnostics.filter(
      (d) => d.code === "agent-tool-invalid"
    );
    expect(toolWarnings.length).toBe(1);
    expect(toolWarnings[0].source).toBe("workspace");
    expect(toolWarnings[0].sourceId).toBe("workspace:ws1");
  });

  it("returns empty definitions + empty diagnostics for zero drafts", () => {
    const result = buildWorkspaceAgentDefinitions(
      [],
      WORKSPACE_ID,
      KNOWN_TOOLS
    );
    expect(result.definitions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("derives the definition id from the VALIDATED frontmatter name, not the filename", () => {
    const result = buildWorkspaceAgentDefinitions(
      [
        makeDraft({
          relativePath: ".aifetchly/agents/researcher.md",
          frontmatter: {
            name: "deep-researcher",
            description: "Deep research.",
          },
          body: "body",
        }),
      ],
      WORKSPACE_ID,
      KNOWN_TOOLS
    );

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].id).toBe("workspace:ws1:agent:deep-researcher");
    expect(result.definitions[0].name).toBe("deep-researcher");
  });

  it("does NOT mutate the input drafts (defensive copies)", () => {
    const draft = makeDraft();
    const fmSnapshot = { ...draft.frontmatter };
    buildWorkspaceAgentDefinitions([draft], WORKSPACE_ID, KNOWN_TOOLS);

    expect(draft.frontmatter).toEqual(fmSnapshot);
    expect(draft.body).toBe("You are a lead researcher. Return JSON.\n");
  });

  it("never throws on a malformed draft — surfaces a diagnostic instead", () => {
    const malformed = makeDraft({
      // Non-string name (adversarial). buildAgentDefinition returns
      // {ok:false}; the helper forwards the diagnostic, it does not throw.
      frontmatter: { name: 123 as unknown as string, description: "x" },
    });
    const result = buildWorkspaceAgentDefinitions(
      [malformed],
      WORKSPACE_ID,
      KNOWN_TOOLS
    );
    expect(result.definitions).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
