/**
 * CMD-06 (Phase 15) — promptCommandFrontmatter unit tests.
 *
 * buildPromptCommandDefinition is the SINGLE owner of the CMD-06 schema.
 * Both the global loader (Plan 02) and the workspace conversion path
 * (Plan 02) route parsed frontmatter drafts through this validator so the
 * schema is encoded exactly once.
 *
 * Validation rules (15-CONTEXT.md "Carry-Forward"):
 *   - name matches ^[a-z][a-z0-9_-]*$
 *   - description present, <= 500 chars
 *   - <= 10 aliases, each matching the name pattern
 *   - argumentHint <= 100 chars when present
 *   - type === "prompt" (required — Phase 15 handles prompt only)
 *   - body non-empty (whitespace-only rejected)
 *
 * Pure module: imports only types + AIFetchlyConfigConstants. Verified by
 * a grep gate (no fs/Electron/TypeORM/Vue).
 */
import { describe, expect, it } from "vitest";
import {
  AIFETCHLY_CONFIG_LIMITS,
  COMMAND_NAME_PATTERN,
  COMMAND_NAME_REGEX,
} from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import {
  buildPromptCommandDefinition,
  type PromptCommandDraft,
  type PromptCommandSourceMeta,
} from "@/service/slashCommands/promptCommandFrontmatter";

// --- Fixtures ----------------------------------------------------------------

const baseSourceMeta: PromptCommandSourceMeta = {
  source: "user",
  sourceId: "user",
  sourceLabel: "User",
  requiresTrust: false,
};

function draft(
  overrides: Partial<PromptCommandDraft> = {}
): PromptCommandDraft {
  return {
    frontmatter: {
      name: "review",
      description: "Review code",
      type: "prompt",
      body: "Review this",
    },
    body: "Review this",
    relativePath: "commands/review.md",
    ...overrides,
  };
}

// --- Constants sanity --------------------------------------------------------

describe("CMD-06 constants (AIFetchlyConfigConstants additions)", () => {
  it("exposes the three CMD-06 frontmatter caps", () => {
    expect(AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength).toBe(500);
    expect(AIFETCHLY_CONFIG_LIMITS.commandAliases).toBe(10);
    expect(AIFETCHLY_CONFIG_LIMITS.commandArgumentHintLength).toBe(100);
  });

  it("exports a compiled COMMAND_NAME_REGEX and string COMMAND_NAME_PATTERN", () => {
    expect(COMMAND_NAME_PATTERN).toBe("^[a-z][a-z0-9_-]*$");
    expect(COMMAND_NAME_REGEX).toBeInstanceOf(RegExp);
    expect(COMMAND_NAME_REGEX.test("review")).toBe(true);
    expect(COMMAND_NAME_REGEX.test("review-v2")).toBe(true);
    expect(COMMAND_NAME_REGEX.test("code_review")).toBe(true);
    expect(COMMAND_NAME_REGEX.test("review2")).toBe(true);
    expect(COMMAND_NAME_REGEX.test("Review")).toBe(false);
    expect(COMMAND_NAME_REGEX.test("2review")).toBe(false);
    expect(COMMAND_NAME_REGEX.test("re view")).toBe(false);
  });
});

// --- Valid cases -------------------------------------------------------------

describe("buildPromptCommandDefinition — valid CMD-06 drafts", () => {
  it("minimal valid draft produces a SlashCommandDefinition with type 'prompt'", () => {
    const result = buildPromptCommandDefinition(draft(), baseSourceMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const def = result.definition;
    expect(def.type).toBe("prompt");
    expect(def.id).toBe("user:command:review");
    expect(def.name).toBe("review");
    expect(def.description).toBe("Review code");
    expect(def.aliases).toEqual([]);
    expect(def.argumentHint).toBeUndefined();
    expect(def.source).toBe("user");
    expect(def.sourceId).toBe("user");
    expect(def.sourceLabel).toBe("User");
    expect(def.requiresTrust).toBe(false);
    expect(def.enabled).toBe(true);
    expect(def.body).toBe("Review this");
  });

  it("carries aliases + argumentHint verbatim when provided", () => {
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          aliases: ["rev", "r"],
          argumentHint: "<path>",
          type: "prompt",
        },
        body: "Review this",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.aliases).toEqual(["rev", "r"]);
    expect(result.definition.argumentHint).toBe("<path>");
  });

  it.each([["review-v2"], ["code_review"], ["review2"]])(
    "accepts name %s (pattern allows lowercase + digits/hyphens/underscores)",
    (name) => {
      const result = buildPromptCommandDefinition(
        draft({
          frontmatter: {
            name,
            description: "Review",
            type: "prompt",
          },
          body: "Body",
        }),
        baseSourceMeta
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.definition.name).toBe(name);
    }
  );

  it("builds a stable id derived from sourceMeta.sourceId + name", () => {
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          type: "prompt",
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
    expect(result.definition.id).toBe("workspace:ws-1:command:review");
    expect(result.definition.source).toBe("workspace");
    expect(result.definition.sourceId).toBe("workspace:ws-1");
    expect(result.definition.sourceLabel).toBe("Workspace");
    expect(result.definition.requiresTrust).toBe(true);
  });
});

// --- Invalid cases -----------------------------------------------------------

describe("buildPromptCommandDefinition — invalid CMD-06 drafts", () => {
  it.each([
    ["Review", "uppercase first letter"],
    ["2review", "leading digit"],
    ["re view!", "space + invalid char"],
    ["re.view", "dot not allowed"],
  ])(
    "rejects name %s (%s) with command-name-invalid diagnostic",
    (name, desc) => {
      const result = buildPromptCommandDefinition(
        draft({
          frontmatter: {
            name,
            description: "Review",
            type: "prompt",
          },
          body: "Body",
        }),
        baseSourceMeta
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected diagnostic");
      expect(result.diagnostic.code).toBe("command-name-invalid");
      expect(result.diagnostic.severity).toBe("warning");
      expect(result.diagnostic.recoverable).toBe(true);
      expect(result.diagnostic.sourceId).toBe("user");
      expect(result.diagnostic.filePath).toBe("commands/review.md");
      expect(result.diagnostic.message.length).toBeGreaterThan(0);
      // unused variable lint guard
      void desc;
    }
  );

  it("rejects missing description with command-description-missing", () => {
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          type: "prompt",
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("command-description-missing");
  });

  it("rejects description over the cap (501 > 500) with frontmatter-invalid", () => {
    const longDescription = "a".repeat(501);
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: longDescription,
          type: "prompt",
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

  it("rejects argumentHint over the cap (101 > 100) with frontmatter-invalid", () => {
    const longHint = "x".repeat(101);
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          argumentHint: longHint,
          type: "prompt",
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/argument/i);
  });

  it("rejects more than 10 aliases with frontmatter-invalid", () => {
    const aliases = Array.from({ length: 11 }, (_, i) => `a${i}`);
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          aliases,
          type: "prompt",
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/alias/i);
  });

  it("rejects any alias not matching the name pattern with frontmatter-invalid", () => {
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          aliases: ["valid", "Invalid-Upper"],
          type: "prompt",
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/alias/i);
  });

  it("rejects type present but not 'prompt' with frontmatter-invalid", () => {
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          type: "local",
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/type/i);
  });

  it("rejects type field absent with frontmatter-invalid", () => {
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
        },
        body: "Body",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/type/i);
  });

  it("rejects empty body (zero-length) with frontmatter-invalid", () => {
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          type: "prompt",
        },
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
    const result = buildPromptCommandDefinition(
      draft({
        frontmatter: {
          name: "review",
          description: "Review",
          type: "prompt",
        },
        body: "   \n\t  ",
      }),
      baseSourceMeta
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic.code).toBe("frontmatter-invalid");
    expect(result.diagnostic.message).toMatch(/body/i);
  });
});

// --- Invariants --------------------------------------------------------------

describe("buildPromptCommandDefinition — invariants", () => {
  it("returns defensive copies — mutating the input draft does NOT change a previously-returned definition", () => {
    const d = draft({
      frontmatter: {
        name: "review",
        description: "Review",
        aliases: ["rev"],
        argumentHint: "<path>",
        type: "prompt",
      },
      body: "Body",
    });
    const result = buildPromptCommandDefinition(d, baseSourceMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const snapshot = result.definition;

    // Mutate the input draft AFTER the call. Casts sidestep the readonly
    // contract on PromptCommandDraft deliberately — the whole point of this
    // test is to verify that even an adversarial caller who DOES mutate the
    // input cannot affect a previously-returned defensive snapshot.
    if (Array.isArray(d.frontmatter.aliases)) {
      (d.frontmatter.aliases as string[]).push("new-alias");
    }
    (d.frontmatter as Record<string, unknown>).description = "TAMPERED";
    (d.frontmatter as Record<string, unknown>).argumentHint = "TAMPERED";
    (d as { body: string }).body = "TAMPERED";

    // The previously-returned definition is unaffected.
    expect(snapshot.aliases).toEqual(["rev"]);
    expect(snapshot.description).toBe("Review");
    expect(snapshot.argumentHint).toBe("<path>");
    expect(snapshot.body).toBe("Body");
  });

  it("definition.aliases is a fresh array — mutating it does NOT affect the draft or future calls", () => {
    const d = draft({
      frontmatter: {
        name: "review",
        description: "Review",
        aliases: ["rev", "r"],
        type: "prompt",
      },
      body: "Body",
    });
    const r1 = buildPromptCommandDefinition(d, baseSourceMeta);
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("expected ok");
    expect(r1.definition.aliases).toEqual(["rev", "r"]);

    // Mutate the returned aliases array.
    (r1.definition.aliases as string[]).push("injected");

    // A second call on the same draft still returns the original aliases.
    const r2 = buildPromptCommandDefinition(d, baseSourceMeta);
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("expected ok");
    expect(r2.definition.aliases).toEqual(["rev", "r"]);
  });

  it("NEVER throws — a malformed draft with non-string scalar values returns {ok:false, diagnostic}", () => {
    const malformed: PromptCommandDraft = {
      frontmatter: {
        name: 123 as unknown as string, // number where string expected
        description: undefined as unknown as string,
        type: null as unknown as string,
      },
      body: "Body",
      relativePath: "commands/bad.md",
    };
    const result = buildPromptCommandDefinition(malformed, baseSourceMeta);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic).toBeDefined();
    expect(typeof result.diagnostic.code).toBe("string");
    expect(result.diagnostic.filePath).toBe("commands/bad.md");
  });

  it("NEVER throws — aliases as a non-array (string scalar instead) returns {ok:false, diagnostic}", () => {
    const malformed: PromptCommandDraft = {
      frontmatter: {
        name: "review",
        description: "Review",
        aliases: "single-string" as unknown as string[], // wrong shape
        type: "prompt",
      },
      body: "Body",
      relativePath: "commands/bad.md",
    };
    const result = buildPromptCommandDefinition(malformed, baseSourceMeta);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected diagnostic");
    expect(result.diagnostic).toBeDefined();
  });
});
