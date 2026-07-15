/**
 * AGT-02 / DX-01 (Phase 16) — agentFrontmatter unit tests.
 *
 * buildAgentDefinition is the SINGLE owner of the agent frontmatter schema
 * (a structural clone of Phase 15 buildPromptCommandDefinition with agent-
 * specific fields: tools array + maxToolCalls/maxRuntimeMs numeric bounds).
 * Both the global loader (Plan 02) and the workspace draft->definition
 * converter (Plan 02) route parsed frontmatter through this validator so
 * the schema is encoded exactly once.
 *
 * detectUnknownTools is a SEPARATE pure helper that emits non-fatal
 * agent-tool-invalid (DX-01) warnings — kept out of the validator so the
 * validator stays single-purpose and the loader owns emitting the warnings.
 *
 * Validation order (first violation wins):
 *   1. name present + matches ^[a-z][a-z0-9_-]*$            -> agent-name-invalid
 *   2. description present + non-empty                       -> frontmatter-missing
 *   3. description length <= 500                             -> frontmatter-invalid
 *   4. tools optional string[] (each non-empty)              -> frontmatter-invalid
 *   5. maxToolCalls optional positive int                    -> frontmatter-invalid
 *   6. maxRuntimeMs optional positive int                    -> frontmatter-invalid
 *   7. body non-empty after trim                             -> frontmatter-invalid
 *
 * Pure module: imports only types + AIFetchlyConfigConstants. Verified by
 * a grep gate (no fs/Electron/TypeORM/Vue).
 */
import { describe, expect, it } from "vitest";
import {
  AIFETCHLY_CONFIG_LIMITS,
  COMMAND_NAME_REGEX,
} from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import {
  buildAgentDefinition,
  detectUnknownTools,
  type AgentDefinitionDraft,
  type AgentDefinitionSourceMeta,
} from "@/service/slashCommands/agentFrontmatter";

// --- Fixtures ----------------------------------------------------------------

const baseSourceMeta: AgentDefinitionSourceMeta = {
  source: "user",
  sourceId: "user",
  sourceLabel: "User",
  requiresTrust: false,
};

function draft(
  overrides: Partial<AgentDefinitionDraft> = {}
): AgentDefinitionDraft {
  return {
    frontmatter: {
      name: "lead-researcher",
      description: "Research leads",
    },
    body: "You are a lead researcher.",
    relativePath: "agents/lead-researcher.md",
    ...overrides,
  };
}

// --- Valid cases -------------------------------------------------------------

describe("buildAgentDefinition — valid AGT-02 drafts", () => {
  it("minimal valid draft produces an AgentDefinitionView with system defaults", () => {
    const result = buildAgentDefinition(draft(), baseSourceMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const def = result.definition;
    // Scoped ID mirrors the command convention: ${sourceId}:agent:${name}.
    expect(def.id).toBe("user:agent:lead-researcher");
    expect(def.name).toBe("lead-researcher");
    expect(def.description).toBe("Research leads");
    expect(def.version).toBe(1);
    expect(def.mode).toBe("specialist");
    expect(def.status).toBe("active");
    expect(def.systemPrompt).toBe("You are a lead researcher.");
    // System defaults from CONTEXT Claude's Discretion.
    expect(def.maxToolCalls).toBe(8);
    expect(def.maxRuntimeMs).toBe(180000);
    expect(def.maxContinueCalls).toBe(8);
    // allowedTools defaults to empty array when tools absent.
    expect(def.allowedTools).toEqual([]);
    // outputSchema is an empty object (structured authoring deferred —
    // RESEARCH Pitfall 4). The field is ALWAYS present (required-typed).
    expect(def.outputSchema).toEqual({});
    expect(def.manifest?.sourceLocation).toEqual({
      sourceId: "user",
      sourceLabel: "User",
      relativePath: "agents/lead-researcher.md",
    });
  });

  it("stores the optional source root for local config agent locations", () => {
    const result = buildAgentDefinition(draft(), {
      ...baseSourceMeta,
      rootPath: "/home/user/.aifetchly",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.manifest?.sourceLocation).toEqual({
      sourceId: "user",
      sourceLabel: "User",
      relativePath: "agents/lead-researcher.md",
      rootPath: "/home/user/.aifetchly",
    });
  });

  it("builds a scoped id derived from sourceMeta.sourceId + name (workspace form)", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research leads",
        },
        body: "Body",
      }),
      {
        source: "workspace",
        sourceId: "workspace:ws-1",
        sourceLabel: "Workspace",
        requiresTrust: true,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.id).toBe("workspace:ws-1:agent:lead-researcher");
  });

  it("carries tools + numeric bounds verbatim when provided", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research",
          tools: ["web_search", "read_file"],
          maxToolCalls: "12",
          maxRuntimeMs: "60000",
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const def = result.definition;
    expect(def.allowedTools).toEqual(["web_search", "read_file"]);
    expect(def.maxToolCalls).toBe(12);
    expect(def.maxRuntimeMs).toBe(60000);
  });

  it.each(["lead-researcher", "lead_researcher", "lead2"])(
    "accepts name %s (pattern allows lowercase + digits/hyphens/underscores)",
    (name) => {
      const result = buildAgentDefinition(
        draft({
          frontmatter: { name, description: "Research" },
          body: "Body",
        }),
        baseSourceMeta
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.definition.name).toBe(name);
    }
  );
});

// --- Invalid cases (first violation wins) -----------------------------------

describe("buildAgentDefinition — invalid AGT-02 drafts", () => {
  it.each([
    ["Lead", "uppercase first letter"],
    ["2lead", "leading digit"],
    ["le ad", "space"],
    ["le.ad", "dot not allowed"],
  ])("rejects name %s (%s) with agent-name-invalid", (name, desc) => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: { name, description: "Research" },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("agent-name-invalid");
    expect(result.diagnostic.severity).toBe("warning");
    expect(result.diagnostic.recoverable).toBe(true);
    expect(result.diagnostic.sourceId).toBe("user");
    expect(result.diagnostic.filePath).toBe("agents/lead-researcher.md");
    expect(result.diagnostic.message.length).toBeGreaterThan(0);
    void desc;
  });

  it("rejects missing name with agent-name-invalid", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: { description: "Research" },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("agent-name-invalid");
  });

  it("rejects missing description with a frontmatter-missing-style diagnostic", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: { name: "lead-researcher" },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-missing");
    expect(result.diagnostic.message).toMatch(/description/i);
  });

  it("rejects empty/whitespace description with frontmatter-missing", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: { name: "lead-researcher", description: "   " },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-missing");
  });

  it("rejects description over the cap (501 > 500) with frontmatter-invalid", () => {
    const longDescription = "a".repeat(501);
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: longDescription,
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/description/i);
  });

  it("rejects tools that is not an array with frontmatter-invalid", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research",
          tools: "web_search", // wrong shape — scalar instead of array
        } as unknown as AgentDefinitionDraft["frontmatter"],
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/tools/i);
  });

  it("rejects tools with a non-string entry with frontmatter-invalid", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research",
          tools: ["web_search", 42 as unknown as string],
        } as unknown as AgentDefinitionDraft["frontmatter"],
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
  });

  it("rejects tools with an empty-string entry with frontmatter-invalid", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research",
          tools: ["web_search", ""],
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
  });

  it.each(["0", "-1", "abc", "2.5"])(
    "rejects non-positive-integer maxToolCalls %s with frontmatter-invalid",
    (val) => {
      const result = buildAgentDefinition(
        draft({
          frontmatter: {
            name: "lead-researcher",
            description: "Research",
            maxToolCalls: val,
          },
          body: "Body",
        }),
        baseSourceMeta
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected diagnostic");
      expect(result.diagnostic.code).toBe("frontmatter-invalid");
      expect(result.diagnostic.message).toMatch(/maxToolCalls/i);
    }
  );

  it.each(["0", "-1", "abc"])(
    "rejects non-positive-integer maxRuntimeMs %s with frontmatter-invalid",
    (val) => {
      const result = buildAgentDefinition(
        draft({
          frontmatter: {
            name: "lead-researcher",
            description: "Research",
            maxRuntimeMs: val,
          },
          body: "Body",
        }),
        baseSourceMeta
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected diagnostic");
      expect(result.diagnostic.code).toBe("frontmatter-invalid");
      expect(result.diagnostic.message).toMatch(/maxRuntimeMs/i);
    }
  );

  it("rejects empty body with frontmatter-invalid", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: { name: "lead-researcher", description: "Research" },
        body: "",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/body/i);
  });

  it("rejects whitespace-only body with frontmatter-invalid", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: { name: "lead-researcher", description: "Research" },
        body: "   \n\t  ",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/body/i);
  });

  it("first violation wins: name error beats description error", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: { name: "Bad Name", description: "" },
        body: "",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    // name is checked before description/body — agent-name-invalid wins.
    expect(result.diagnostic.code).toBe("agent-name-invalid");
  });
});

// --- Invariants --------------------------------------------------------------

describe("buildAgentDefinition — invariants", () => {
  it("returns a defensive copy — mutating the input draft does NOT change a previously-returned definition", () => {
    const d = draft({
      frontmatter: {
        name: "lead-researcher",
        description: "Research",
        tools: ["web_search"],
      },
      body: "Body",
    });
    const result = buildAgentDefinition(d, baseSourceMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const snapshot = result.definition;

    // Adversarially mutate the input after the call.
    if (Array.isArray(d.frontmatter.tools)) {
      (d.frontmatter.tools as string[]).push("injected");
    }
    (d.frontmatter as Record<string, unknown>).description = "TAMPERED";
    (d as { body: string }).body = "TAMPERED";

    expect(snapshot.allowedTools).toEqual(["web_search"]);
    expect(snapshot.description).toBe("Research");
    expect(snapshot.systemPrompt).toBe("Body");
  });

  it("definition.allowedTools is a fresh array — mutating it does NOT affect future calls", () => {
    const d = draft({
      frontmatter: {
        name: "lead-researcher",
        description: "Research",
        tools: ["web_search", "read_file"],
      },
      body: "Body",
    });
    const r1 = buildAgentDefinition(d, baseSourceMeta);
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("expected ok");
    expect(r1.definition.allowedTools).toEqual(["web_search", "read_file"]);

    // Mutate the returned array.
    (r1.definition.allowedTools as string[]).push("injected");

    const r2 = buildAgentDefinition(d, baseSourceMeta);
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("expected ok");
    expect(r2.definition.allowedTools).toEqual(["web_search", "read_file"]);
  });

  it("NEVER throws — a malformed draft with non-string scalars returns {ok:false, diagnostic}", () => {
    const malformed: AgentDefinitionDraft = {
      frontmatter: {
        name: 123 as unknown as string,
        description: undefined as unknown as string,
      },
      body: "Body",
      relativePath: "agents/bad.md",
    };
    const result = buildAgentDefinition(malformed, baseSourceMeta);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic).toBeDefined();
    expect(typeof result.diagnostic.code).toBe("string");
    expect(result.diagnostic.filePath).toBe("agents/bad.md");
  });

  it("never omits outputSchema even when the draft is valid (required-typed field)", () => {
    const result = buildAgentDefinition(draft(), baseSourceMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.outputSchema).toBeDefined();
    expect(result.definition.outputSchema).toEqual({});
  });
});

// --- Constants sanity --------------------------------------------------------

describe("AGT-02 constants reused from AIFetchlyConfigConstants", () => {
  it("reuses the command description length cap for agents", () => {
    expect(AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength).toBe(500);
  });

  it("reuses COMMAND_NAME_REGEX for agent name validation", () => {
    expect(COMMAND_NAME_REGEX.test("lead-researcher")).toBe(true);
    expect(COMMAND_NAME_REGEX.test("Lead")).toBe(false);
  });
});

// --- detectUnknownTools (DX-01, D-ToolDiagnostic) ---------------------------

describe("detectUnknownTools (DX-01 non-fatal warning)", () => {
  it("emits exactly one agent-tool-invalid diagnostic per unknown tool", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research",
          tools: ["web_search", "ghost_tool"],
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const def = result.definition;

    const registered = new Set<string>(["web_search"]);
    const diagnostics = detectUnknownTools(def, registered);
    expect(diagnostics).toHaveLength(1);
    const diag = diagnostics[0];
    expect(diag.code).toBe("agent-tool-invalid");
    expect(diag.severity).toBe("warning");
    expect(diag.recoverable).toBe(true);
    expect(diag.message).toMatch(/ghost_tool/);
    expect(diag.sourceId).toBe("user");
  });

  it("emits ZERO diagnostics when every tool is registered", () => {
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research",
          tools: ["web_search", "read_file"],
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const def = result.definition;

    const registered = new Set<string>(["web_search", "read_file"]);
    expect(detectUnknownTools(def, registered)).toEqual([]);
  });

  it("emits ZERO diagnostics for an empty allowedTools list", () => {
    const result = buildAgentDefinition(draft(), baseSourceMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const def = result.definition;
    expect(def.allowedTools).toEqual([]);
    expect(detectUnknownTools(def, new Set<string>(["web_search"]))).toEqual(
      []
    );
  });

  it("is non-fatal: a valid definition with unknown tools is still registrable", () => {
    // The validator (buildAgentDefinition) returns ok:true regardless of tool
    // registration — detectUnknownTools is a SEPARATE helper the loader calls
    // AFTER validation. This confirms the separation of concerns.
    const result = buildAgentDefinition(
      draft({
        frontmatter: {
          name: "lead-researcher",
          description: "Research",
          tools: ["totally_made_up_tool"],
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.allowedTools).toEqual(["totally_made_up_tool"]);
  });

  it("accepts a ReadonlySet<string> of registered tool names", () => {
    const result = buildAgentDefinition(draft(), baseSourceMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // ReadonlySet<string> is the documented contract — a plain Set works.
    const readonlySet: ReadonlySet<string> = new Set(["a", "b"]);
    expect(detectUnknownTools(result.definition, readonlySet)).toEqual([]);
  });
});
