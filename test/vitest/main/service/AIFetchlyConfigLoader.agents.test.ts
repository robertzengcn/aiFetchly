/**
 * AGT-02 (Phase 16 / Plan 02) — global loader agent-scan tests.
 *
 * AIFetchlyConfigLoader now reads ~/.aifetchly/agents/*.md, parses each with
 * the restricted frontmatter parser (CFG-07), validates via buildAgentDefinition
 * (Plan 01), and fills snapshot.agents with the resulting AgentDefinitionView[]
 * (source 'user', sourceId 'user'). Invalid files produce diagnostics and are
 * skipped. Unknown tools are non-fatal (D-ToolDiagnostic).
 *
 * Integration-style: each test builds an ephemeral fake ~/.aifetchly under
 * os.tmpdir() and points the loader at it via the rootPath constructor arg.
 *
 * Mirrors AIFetchlyConfigLoader.commands.test.ts (the CMD-06 sibling).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { AIFetchlyConfigLoader } from "@/service/aifetchlyConfig/AIFetchlyConfigLoader";
import {
  AIFetchlyConfigManager,
  getAIFetchlyConfigManager,
} from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";

const VALID_AGENT =
  "---\nname: lead-researcher\ndescription: Gathers public business context for a lead.\ntools:\n  - scrape_urls_from_search_engine\n---\n\nYou are a lead researcher. Return JSON.\n";

/** A set of tool names known to the test harness (used for D-ToolDiagnostic). */
const KNOWN_TOOLS = new Set<string>([
  "scrape_urls_from_search_engine",
  "knowledge_library_search",
]);

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-agents-"));
}

function writeAgent(root: string, name: string, content: string): void {
  const dir = path.join(root, "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, "utf8");
}

describe("AIFetchlyConfigLoader agent scan (AGT-02 / SC1 global)", () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  it("reads one valid agents/lead-researcher.md into a user:agent:* AgentDefinitionView", async () => {
    const root = makeRoot();
    roots.push(root);
    writeAgent(root, "lead-researcher.md", VALID_AGENT);

    const snapshot = await new AIFetchlyConfigLoader(root, {
      registeredToolNames: KNOWN_TOOLS,
    }).scanGlobalRoot();

    expect(snapshot.agents).toHaveLength(1);
    const agent = snapshot.agents[0] as {
      id: string;
      name: string;
      description: string;
      mode: string;
      allowedTools: string[];
      systemPrompt: string;
    };
    expect(agent.id).toBe("user:agent:lead-researcher");
    expect(agent.name).toBe("lead-researcher");
    expect(agent.description).toContain("lead");
    expect(agent.mode).toBe("specialist");
    expect(agent.allowedTools).toEqual(["scrape_urls_from_search_engine"]);
    expect(agent.systemPrompt).toContain("lead researcher");
  });

  it("reads two valid agent files into two user:agent:* definitions", async () => {
    const root = makeRoot();
    roots.push(root);
    writeAgent(root, "lead-researcher.md", VALID_AGENT);
    writeAgent(
      root,
      "outreach-writer.md",
      "---\nname: outreach-writer\ndescription: Writes outreach messages.\n---\n\nYou write outreach copy.\n"
    );

    const snapshot = await new AIFetchlyConfigLoader(root, {
      registeredToolNames: KNOWN_TOOLS,
    }).scanGlobalRoot();

    expect(snapshot.agents).toHaveLength(2);
    const ids = (snapshot.agents as { id: string }[]).map((a) => a.id).sort();
    expect(ids).toEqual([
      "user:agent:lead-researcher",
      "user:agent:outreach-writer",
    ]);
  });

  it("produces an agent-name-invalid diagnostic and skips a file with a bad name (AGT-02)", async () => {
    const root = makeRoot();
    roots.push(root);
    // Uppercase name fails COMMAND_NAME_REGEX.
    writeAgent(
      root,
      "Bad.md",
      "---\nname: Bad\ndescription: Has desc\n---\n\nbody\n"
    );

    const snapshot = await new AIFetchlyConfigLoader(root, {
      registeredToolNames: KNOWN_TOOLS,
    }).scanGlobalRoot();

    expect(snapshot.agents).toHaveLength(0);
    const codes = snapshot.diagnostics.map((d) => d.code);
    expect(codes).toContain("agent-name-invalid");
  });

  it("produces a file-too-large diagnostic and skips an oversized agent file (CFG-04)", async () => {
    const root = makeRoot();
    roots.push(root);
    const big =
      "---\nname: big\ndescription: x\n---\n\n" +
      "x".repeat(AIFETCHLY_CONFIG_LIMITS.agentMdBytes + 1);
    writeAgent(root, "big.md", big);

    const snapshot = await new AIFetchlyConfigLoader(root, {
      registeredToolNames: KNOWN_TOOLS,
    }).scanGlobalRoot();

    expect(snapshot.agents).toHaveLength(0);
    const codes = snapshot.diagnostics.map((d) => d.code);
    expect(codes).toContain("file-too-large");
  });

  it("enforces the maxAgentsPerSource count cap and skips the remainder with diagnostics", async () => {
    const root = makeRoot();
    roots.push(root);
    const body = "---\nname: agent-{i}\ndescription: agent {i}\n---\n\nbody\n";
    // Write more than the cap.
    const overCount = AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource + 2;
    for (let i = 0; i < overCount; i++) {
      writeAgent(root, `agent-${i}.md`, body.replace(/\{i\}/g, String(i)));
    }

    const snapshot = await new AIFetchlyConfigLoader(root, {
      registeredToolNames: KNOWN_TOOLS,
    }).scanGlobalRoot();

    // Exactly the cap is loaded.
    expect(snapshot.agents.length).toBe(
      AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource
    );
    // A count-cap diagnostic is produced.
    const codes = snapshot.diagnostics.map((d) => d.code);
    expect(codes).toContain("file-too-large");
  });

  it("still registers an agent with an unknown tool AND emits an agent-tool-invalid diagnostic (D-ToolDiagnostic non-fatal)", async () => {
    const root = makeRoot();
    roots.push(root);
    writeAgent(
      root,
      "mystery.md",
      "---\nname: mystery\ndescription: Uses a tool no one registered.\ntools:\n  - non_existent_tool_xyz\n---\n\nbody\n"
    );

    const snapshot = await new AIFetchlyConfigLoader(root, {
      registeredToolNames: KNOWN_TOOLS,
    }).scanGlobalRoot();

    // The agent IS still registered (non-fatal).
    expect(snapshot.agents).toHaveLength(1);
    const agent = snapshot.agents[0] as { id: string; name: string };
    expect(agent.id).toBe("user:agent:mystery");
    // And a warning is emitted.
    const toolWarnings = snapshot.diagnostics.filter(
      (d) => d.code === "agent-tool-invalid"
    );
    expect(toolWarnings.length).toBe(1);
    expect(toolWarnings[0]?.source).toBe("user");
    expect(toolWarnings[0]?.sourceId).toBe("user");
  });

  it("missing agents/ dir -> empty agents, NO diagnostic (happy path)", async () => {
    const root = makeRoot();
    roots.push(root);
    // Only AGENTS.md, no agents/ dir.
    fs.writeFileSync(path.join(root, "AGENTS.md"), "be helpful", "utf8");

    const snapshot = await new AIFetchlyConfigLoader(root, {
      registeredToolNames: KNOWN_TOOLS,
    }).scanGlobalRoot();

    expect(snapshot.agents).toHaveLength(0);
    expect(snapshot.diagnostics.map((d) => d.code)).not.toContain(
      "file-too-large"
    );
    expect(snapshot.diagnostics.map((d) => d.code)).not.toContain(
      "agent-name-invalid"
    );
  });
});

describe("AIFetchlyConfigManager — agent registry ownership (AGT-02)", () => {
  it("getAgentRegistry() returns a registry with built-ins already registered", () => {
    const manager = new AIFetchlyConfigManager({
      rootPath: makeRoot(),
    });
    const registry = manager.getAgentRegistry();
    expect(registry).toBeDefined();
    // Built-in lead-researcher is seeded at construction.
    const builtIns = registry.listBuiltIns();
    expect(builtIns.length).toBeGreaterThan(0);
    // getById resolves a built-in by bare id.
    const lead = registry.getById("agent-lead-researcher");
    expect(lead).not.toBeNull();
    expect(lead?.name).toBe("Lead Researcher");
  });

  it("getStatus().agentCount reflects the registry size (not hardcoded 0)", () => {
    const manager = new AIFetchlyConfigManager({
      rootPath: makeRoot(),
    });
    const status = manager.getStatus();
    expect(status.agentCount).toBeGreaterThan(0);
    // Must equal the registry's list length.
    expect(status.agentCount).toBe(manager.getAgentRegistry().list().length);
  });

  it("getAIFetchlyConfigManager() exposes the same agent registry accessor", () => {
    const m = getAIFetchlyConfigManager();
    expect(typeof m.getAgentRegistry).toBe("function");
    expect(m.getAgentRegistry().listBuiltIns().length).toBeGreaterThan(0);
  });
});
