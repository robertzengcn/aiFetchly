/**
 * Tests for the deterministic installer policy layer (design §8.5-8.7):
 * intent-guard phrase matrix, routing-prompt snapshot, tool-policy
 * allow/deny matrix, and the deferred-hydration replay cap.
 */
import { describe, expect, it } from "vitest";
import {
  classifySkillRequestIntent,
  extractInstalledSkillName,
  extractSource,
} from "@/service/SkillInstallIntentGuard";
import {
  buildSkillInstallationRoutingSection,
  SKILL_INSTALL_COMPACT_REMINDER,
} from "@/service/SkillInstallationRoutingPromptSection";
import {
  evaluateSkillInstallationToolPolicy,
  installFirstToolCounterKey,
} from "@/service/SkillInstallationToolPolicy";
import {
  shouldHydrateAndReplay,
  HydrationReplayLedger,
  decideDeferredToolHydration,
  stableToolCallFingerprint,
} from "@/service/DeferredToolHydrationCoordinator";
import {
  intersectSkillToolAllowlists,
  applySkillToolNarrowing,
} from "@/service/PromptSkillToolNarrowing";
import { parseManualActionApprovalDetail } from "@/entityTypes/skillInstallationTypes";
import { shellSplit } from "@/service/SkillInstallPlanner";

// ---------------------------------------------------------------------------
// Intent guard — FR-01 / FR-26 / FR-27 boundary matrix (design §21.1)
// ---------------------------------------------------------------------------

describe("classifySkillRequestIntent", () => {
  const explicitInstall = [
    "Set up https://github.com/browser-use/video-use for me",
    "Please install this skill: https://github.com/anthropics/skills",
    "Register the skill from https://github.com/foo/bar.git",
    "install the skill package from ./my-skill-folder",
  ];
  const notInstall = [
    "install node dependencies for this project",
    "clone my repository and run the tests",
    "configure ffmpeg for this project",
    "pip install requests",
    "what is the weather today",
    "read this file and summarize it",
  ];

  it.each(explicitInstall)("routes '%s' to the typed installer", (message) => {
    const decision = classifySkillRequestIntent(message);
    expect(decision.intent).toBe("install-package");
    expect(decision.confidence).toBe("explicit");
    expect(decision.allowedEntryPoint).toBe("skill_install_prepare");
  });

  // FR-26: update/repair/configure/uninstall route to the session-scoped
  // lifecycle entry points, NOT prepare (which needs a source).
  it("routes update/repair/configure phrases to the lifecycle action entry", () => {
    const update = classifySkillRequestIntent("update my skills");
    expect(update.intent).toBe("update-package");
    expect(update.allowedEntryPoint).toBe("skill_install_session_action");
    expect(update.confidence).toBe("explicit");

    const repair = classifySkillRequestIntent(
      "repair the installed video-use skill"
    );
    expect(repair.intent).toBe("repair-package");
    expect(repair.allowedEntryPoint).toBe("skill_install_session_action");
    expect(repair.skillName).toBe("video-use");

    const configure = classifySkillRequestIntent(
      "configure the installed video-use skill"
    );
    expect(configure.intent).toBe("configure-package");
    expect(configure.skillName).toBe("video-use");

    const uninstall = classifySkillRequestIntent("remove the scrape plugin");
    expect(uninstall.intent).toBe("manage-installation");
    expect(uninstall.skillName).toBe("scrape");
  });

  it("extracts installed-skill names from identity-first phrases", () => {
    expect(extractInstalledSkillName("update video-use")).toBe("video-use");
    expect(
      extractInstalledSkillName("repair the installed video-use skill")
    ).toBe("video-use");
    expect(extractInstalledSkillName("update my skills")).toBeNull();
    expect(extractInstalledSkillName("update the plugin")).toBeNull();
  });

  it.each(notInstall)("does NOT intercept '%s'", (message) => {
    const decision = classifySkillRequestIntent(message);
    expect(decision.allowedEntryPoint).toBe("normal-tool-policy");
    expect(decision.confidence).not.toBe("explicit");
  });

  it("extracts the GitHub source from the video-use request", () => {
    const decision = classifySkillRequestIntent(
      "Set up https://github.com/browser-use/video-use for me. Read install.md first."
    );
    expect(decision.source).toBe("https://github.com/browser-use/video-use");
  });

  it("daily-use phrasing routes to use_skill, not the installer", () => {
    const decision = classifySkillRequestIntent(
      "use the video-use skill to edit this clip"
    );
    expect(decision.intent).toBe("invoke-prompt-skill");
    expect(decision.allowedEntryPoint).toBe("use_skill");
  });
});

describe("extractSource", () => {
  it("finds github URLs, .git URLs, and local paths", () => {
    expect(extractSource("clone https://github.com/a/b please")).toBe(
      "https://github.com/a/b"
    );
    expect(extractSource("from https://example.com/repo.git ok")).toBe(
      "https://example.com/repo.git"
    );
    expect(extractSource("install ./folder/skill.zip")).toBe(
      "./folder/skill.zip"
    );
  });
});

// ---------------------------------------------------------------------------
// Routing prompt snapshot — every normative rule exactly once (design §8.5)
// ---------------------------------------------------------------------------

describe("buildSkillInstallationRoutingSection", () => {
  const section = buildSkillInstallationRoutingSection();

  it("contains all seven normative rules", () => {
    expect(section).toContain("Call skill_install_prepare");
    expect(section).toContain(
      "Do not clone the repository using shell_execute"
    );
    expect(section).toContain("Do not search the tool catalog for Git");
    expect(section).toContain("session_id and next_action");
    expect(section).toContain("Never accept API keys through chat");
    expect(section).toContain("Do not execute the installed skill");
    expect(section).toContain("report readiness");
  });

  it("states the use_skill boundary", () => {
    expect(section).toContain(
      "It does not install, update, repair, or configure skill packages."
    );
  });

  it("is provider-neutral (no Claude/Codex/OpenAI roles)", () => {
    expect(section).not.toMatch(/\b(Claude|Codex|OpenAI|Anthropic)\b/);
  });

  it("mentions skill_install_prepare exactly once as the entry point", () => {
    expect(section.split("skill_install_prepare").length - 1).toBe(1);
  });

  it("compact reminder preserves the same directives", () => {
    expect(SKILL_INSTALL_COMPACT_REMINDER).toContain("skill_install_prepare");
    expect(SKILL_INSTALL_COMPACT_REMINDER).toContain("never pass secrets");
  });
});

// ---------------------------------------------------------------------------
// Tool policy — FR-30 allow/deny matrix (design §21.1)
// ---------------------------------------------------------------------------

describe("evaluateSkillInstallationToolPolicy", () => {
  const routing = classifySkillRequestIntent(
    "Set up https://github.com/browser-use/video-use for me"
  );

  it("blocks shell clone commands for the recognized target", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command: "git clone https://github.com/browser-use/video-use",
      },
    });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.code).toBe("INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED");
    expect(verdict.message).toContain("skill_install_prepare");
  });

  it("allows unrelated workspace shell commands", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: { command: "ls -la" },
    });
    expect(verdict.allowed).toBe(true);
  });

  it("blocks file writes under the install destination", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "file_write",
      toolArguments: { path: "/home/u/.aifetchly/skills/video-use/SKILL.md" },
    });
    expect(verdict.allowed).toBe(false);
  });

  it("blocks catalog searches for git/filesystem installation substitutes", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "tool_catalog_search",
      toolArguments: { query: "git clone" },
    });
    expect(verdict.allowed).toBe(false);
  });

  it("allows unrelated reads that do not target the install source", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "file_read",
      toolArguments: { path: "/workspace/notes.txt" },
    });
    expect(verdict.allowed).toBe(true);
  });

  it("allows installer tools themselves", () => {
    for (const toolName of [
      "skill_install_prepare",
      "skill_install_approve",
      "skill_install_status",
    ]) {
      expect(
        evaluateSkillInstallationToolPolicy({
          routing,
          toolName,
          toolArguments: {},
        }).allowed
      ).toBe(true);
    }
  });

  it("allows generic tools when no explicit intent is active", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing: classifySkillRequestIntent("what is the weather"),
      toolName: "shell_execute",
      toolArguments: { command: "git clone https://github.com/a/b" },
    });
    expect(verdict.allowed).toBe(true);
  });

  it("permits a generic fallback after a typed manual-action approval (legacy boolean)", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command: "git clone https://github.com/browser-use/video-use",
      },
      manualActionApproved: true,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("an operation-bound approval authorizes ONLY that exact command (audit R8)", () => {
    const approved = {
      target: "https://github.com/browser-use/video-use",
      toolName: "shell_execute",
      operation: "git clone https://github.com/browser-use/video-use",
    };
    // The exact approved command passes.
    const exact = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command: "git clone https://github.com/browser-use/video-use",
      },
      manualActionApproved: approved,
    });
    expect(exact.allowed).toBe(true);
    // A DIFFERENT command against the same target is refused — a
    // target-only scope authorized any call.
    const other = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command:
          "curl -L -o v.zip https://github.com/browser-use/video-use/archive.zip",
      },
      manualActionApproved: approved,
    });
    expect(other.allowed).toBe(false);
    // Whitespace normalization: the same command with different spacing
    // still matches.
    const spaced = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command: "git   clone   https://github.com/browser-use/video-use",
      },
      manualActionApproved: approved,
    });
    expect(spaced.allowed).toBe(true);
    // A different TOOL is refused even with a matching target+command.
    const otherTool = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "file_write",
      toolArguments: {
        command: "git clone https://github.com/browser-use/video-use",
      },
      manualActionApproved: approved,
    });
    expect(otherTool.allowed).toBe(false);
  });

  it("an approval naming a cwd refuses the same command elsewhere (audit R8)", () => {
    const approved = {
      target: "https://github.com/browser-use/video-use",
      toolName: "shell_execute",
      operation: "uv sync",
      cwd: "/tmp/skill-staging/abc",
    };
    // Same command + same cwd → allowed.
    const ok = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: { command: "uv sync", cwd: "/tmp/skill-staging/abc" },
      manualActionApproved: approved,
    });
    expect(ok.allowed).toBe(true);
    // Same command, DIFFERENT cwd → refused.
    const elsewhere = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: { command: "uv sync", cwd: "/etc" },
      manualActionApproved: approved,
    });
    expect(elsewhere.allowed).toBe(false);
    // Same command, cwd OMITTED → refused (fail closed).
    const noCwd = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: { command: "uv sync" },
      manualActionApproved: approved,
    });
    expect(noCwd.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deferred hydration — FR-28 (design §8.7)
// ---------------------------------------------------------------------------

describe("shouldHydrateAndReplay", () => {
  it("replays the exact pre-mutation sentinel once", () => {
    const result = shouldHydrateAndReplay({
      toolName: "skill_install_prepare",
      callFingerprint: "fp-1",
      result: { error: "deferred tool loaded; please retry the call" },
    });
    expect(result.replayed).toBe(true);
    expect(result.replayCount).toBe(1);
  });

  it("does not replay results that carry mutation evidence", () => {
    const result = shouldHydrateAndReplay({
      toolName: "skill_install_prepare",
      callFingerprint: "fp-2",
      result: {
        error: "deferred tool loaded",
        sessionId: "already-created",
      },
    });
    expect(result.replayed).toBe(false);
  });

  it("does not replay non-sentinel results", () => {
    const result = shouldHydrateAndReplay({
      toolName: "skill_install_prepare",
      callFingerprint: "fp-3",
      result: { error: "network timeout" },
    });
    expect(result.replayed).toBe(false);
  });

  it("the ledger caps each fingerprint to one replay", () => {
    const ledger = new HydrationReplayLedger();
    expect(ledger.consumeReplay("fp")).toBe(true);
    expect(ledger.consumeReplay("fp")).toBe(false);
    expect(ledger.size()).toBe(1);
  });
});

describe("decideDeferredToolHydration — the loop-side transparent replay gate (FR-28)", () => {
  const deferredEntry = { loadPolicy: "deferred" };
  const discovered = new Set<string>();

  it("executes (hydrate + replay) a deferred, undiscovered tool call exactly once", () => {
    const ledger = new HydrationReplayLedger();
    const first = decideDeferredToolHydration({
      catalogActive: true,
      catalogEntry: deferredEntry,
      discoveredToolNames: discovered,
      toolName: "glob_files",
      callArguments: { pattern: "*.md" },
      conversationId: "conv-1",
      ledger,
    });
    expect(first.action).toBe("execute");
    // After the loop adds the name, the same call is ordinary dispatch.
    const afterDiscovery = new Set(["glob_files"]);
    const second = decideDeferredToolHydration({
      catalogActive: true,
      catalogEntry: deferredEntry,
      discoveredToolNames: afterDiscovery,
      toolName: "glob_files",
      callArguments: { pattern: "*.md" },
      conversationId: "conv-1",
      ledger,
    });
    expect(second.action).toBe("none");
  });

  it("is exhausted when the SAME fingerprint replays again (e.g. after a restart reset discovery)", () => {
    const ledger = new HydrationReplayLedger();
    const args = { source: "https://github.com/a/b", constraints: ["x"] };
    const decide = (toolNames: Set<string>) =>
      decideDeferredToolHydration({
        catalogActive: true,
        catalogEntry: deferredEntry,
        discoveredToolNames: toolNames,
        toolName: "file_write",
        callArguments: args,
        conversationId: "conv-2",
        ledger,
      });
    expect(decide(new Set()).action).toBe("execute");
    // Discovery was NOT persisted (restart) — the ledger still refuses.
    expect(decide(new Set()).action).toBe("exhausted");
  });

  it("leaves non-deferred, catalog-inactive, and unknown tools untouched", () => {
    const ledger = new HydrationReplayLedger();
    expect(
      decideDeferredToolHydration({
        catalogActive: false,
        catalogEntry: deferredEntry,
        discoveredToolNames: new Set(),
        toolName: "glob_files",
        callArguments: {},
        conversationId: "c",
        ledger,
      }).action
    ).toBe("none");
    expect(
      decideDeferredToolHydration({
        catalogActive: true,
        catalogEntry: { loadPolicy: "always" },
        discoveredToolNames: new Set(),
        toolName: "skill_install_prepare",
        callArguments: {},
        conversationId: "c",
        ledger,
      }).action
    ).toBe("none");
    expect(
      decideDeferredToolHydration({
        catalogActive: true,
        catalogEntry: undefined,
        discoveredToolNames: new Set(),
        toolName: "mystery_tool",
        callArguments: {},
        conversationId: "c",
        ledger,
      }).action
    ).toBe("none");
  });

  it("fingerprints are key-order independent and conversation-scoped", () => {
    expect(
      stableToolCallFingerprint({ a: 1, b: { c: 2, d: 3 } })
    ).toBe(stableToolCallFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(stableToolCallFingerprint({ a: 1 })).not.toBe(
      stableToolCallFingerprint({ a: 2 })
    );
    // Different conversations get independent replay budgets via the
    // fingerprint prefix — same args, different conversation ids.
    const ledger = new HydrationReplayLedger();
    const args = { q: "x" };
    const decideFor = (conversationId: string) =>
      decideDeferredToolHydration({
        catalogActive: true,
        catalogEntry: deferredEntry,
        discoveredToolNames: new Set(),
        toolName: "t",
        callArguments: args,
        conversationId,
        ledger,
      });
    expect(decideFor("conv-a").action).toBe("execute");
    expect(decideFor("conv-b").action).toBe("execute");
    expect(decideFor("conv-a").action).toBe("exhausted");
  });
});

describe("prompt-skill capability narrowing + helper execution (FR-13, NFR-11)", () => {
  it("no declared allowedTools means no narrowing; declared lists intersect", () => {
    expect(intersectSkillToolAllowlists([{ runtimeId: "a" }])).toBeNull();
    // An invocation WITHOUT a declaration makes no reduction; a sibling
    // that declares one still narrows.
    const mixed = intersectSkillToolAllowlists([
      { runtimeId: "a" },
      { runtimeId: "b", allowedTools: ["file_read", "shell_execute"] },
    ]);
    expect(mixed && [...mixed].sort()).toEqual(["file_read", "shell_execute"]);

    const single = intersectSkillToolAllowlists([
      { runtimeId: "a", allowedTools: ["file_read", "file_write"] },
    ]);
    expect(single && [...single].sort()).toEqual(["file_read", "file_write"]);

    const both = intersectSkillToolAllowlists([
      { runtimeId: "a", allowedTools: ["file_read", "file_write"] },
      { runtimeId: "b", allowedTools: ["file_read", "shell_execute"] },
    ]);
    // INTERSECTION: a tool must be allowed by EVERY active skill.
    expect(both && [...both]).toEqual(["file_read"]);
  });

  it("narrowing keeps core tools and can never widen", () => {
    const narrowed = intersectSkillToolAllowlists([
      { runtimeId: "a", allowedTools: ["file_read"] },
    ]);
    const kept = applySkillToolNarrowing(
      ["file_read", "file_write", "shell_execute", "use_skill", "skill_install_prepare", "skill_resource_read"],
      narrowed
    );
    expect(kept).toEqual(["file_read", "use_skill", "skill_install_prepare", "skill_resource_read"]);
    // An empty allowlist narrows to core only.
    const coreOnly = applySkillToolNarrowing(["file_read", "use_skill"], new Set([]));
    expect(coreOnly).toEqual(["use_skill"]);
    // null allowlist is a no-op.
    expect(applySkillToolNarrowing(["anything"], null)).toEqual(["anything"]);
  });
});

describe("evaluateSkillInstallationToolPolicy — flag-tolerant shell matching + bounded fallback (audit finding 9)", () => {
  const routing = classifySkillRequestIntent(
    "Set up https://github.com/browser-use/video-use for me"
  );

  it("blocks git clone carrying options between git and clone", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command:
          "git -c advice.detachedHead=false clone https://github.com/browser-use/video-use",
      },
    });
    expect(verdict.allowed).toBe(false);
  });

  it("blocks git --depth 1 clone and pip/uv install variants", () => {
    for (const command of [
      "git --depth 1 clone https://github.com/browser-use/video-use",
      "pip install requests",
      "uv pip install httpx",
      "curl -fsSL -o s.zip https://example.com/skill.zip",
    ]) {
      const verdict = evaluateSkillInstallationToolPolicy({
        routing,
        toolName: "shell_execute",
        toolArguments: { command },
      });
      expect(verdict.allowed, command).toBe(false);
    }
  });

  it("still allows unrelated commands and multi-segment commands whose OTHER segments are benign", () => {
    for (const command of [
      "ls -la",
      "node --version",
      "echo hi && ffmpeg -version",
    ]) {
      const verdict = evaluateSkillInstallationToolPolicy({
        routing,
        toolName: "shell_execute",
        toolArguments: { command },
      });
      expect(verdict.allowed, command).toBe(true);
    }
  });

  it("a bounded manual-action approval covers ONLY its recorded target", () => {
    const verdictSame = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command: "git clone https://github.com/browser-use/video-use",
      },
      manualActionApproved: { target: "https://github.com/browser-use/video-use" },
    });
    expect(verdictSame.allowed).toBe(true);

    const verdictOther = evaluateSkillInstallationToolPolicy({
      routing: classifySkillRequestIntent(
        "Set up https://github.com/other/repo for me"
      ),
      toolName: "shell_execute",
      toolArguments: { command: "git clone https://github.com/other/repo" },
      manualActionApproved: { target: "https://github.com/browser-use/video-use" },
    });
    expect(verdictOther.allowed).toBe(false);
  });
});

describe("shell policy cp/tar flag boundaries (audit R8)", () => {
  const routing = classifySkillRequestIntent(
    "Set up https://github.com/browser-use/video-use for me"
  );

  it("blocks cp -r into the skills directory (the \\b-r space-hyphen bug)", () => {
    const verdict = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command: "cp -r video-use ~/.aifetchly/skills/video-use",
      },
    });
    expect(verdict.allowed).toBe(false);
  });

  it("blocks generic cp -r and tar extraction, still allows benign commands", () => {
    for (const [command, allowed] of [
      ["cp -r a b", false],
      ["tar -xvf s.tar.gz", false],
      ["tar -xf bundle.tar", false],
      ["cp a.txt b.txt", true],
      ["ls -la", true],
      ["echo hi && ffmpeg -version", true],
    ] as const) {
      const verdict = evaluateSkillInstallationToolPolicy({
        routing,
        toolName: "shell_execute",
        toolArguments: { command },
      });
      expect(verdict.allowed, command).toBe(allowed);
    }
  });
});

describe("parseManualActionApprovalDetail — audit-event → policy record (audit R8)", () => {
  it("parses a structured R8 record with every bound field", () => {
    const record = parseManualActionApprovalDetail(
      JSON.stringify({
        target: "https://github.com/a/b",
        toolName: "shell_execute",
        operation: "uv sync",
        cwd: "/tmp/x",
        reason: "r",
        permission: "p",
        verification: "v",
        rollback: "rb",
      })
    );
    expect(record).toEqual({
      target: "https://github.com/a/b",
      toolName: "shell_execute",
      operation: "uv sync",
      cwd: "/tmp/x",
      reason: "r",
      permission: "p",
      verification: "v",
      rollback: "rb",
    });
  });

  it("reads a pre-R8 plain-string detail as target-only legacy", () => {
    expect(
      parseManualActionApprovalDetail("https://github.com/a/b")
    ).toEqual({ target: "https://github.com/a/b" });
  });

  it("drops non-string and empty fields, and returns empty for no detail", () => {
    expect(
      parseManualActionApprovalDetail(
        JSON.stringify({ target: "t", operation: 3, cwd: "" })
      )
    ).toEqual({ target: "t" });
    expect(parseManualActionApprovalDetail("")).toEqual({});
  });
});

describe("installFirstToolCounterKey — first-tool-category correlation (audit R10)", () => {
  it("categorizes the first tool after an explicit install request", () => {
    expect(installFirstToolCounterKey("skill_install_prepare")).toBe(
      "install_first_tool_installer"
    );
    expect(installFirstToolCounterKey("skill_install_approve")).toBe(
      "install_first_tool_installer"
    );
    expect(installFirstToolCounterKey("shell_execute")).toBe(
      "install_first_tool_shell"
    );
    expect(installFirstToolCounterKey("file_write")).toBe(
      "install_first_tool_file"
    );
    expect(installFirstToolCounterKey("glob_files")).toBe(
      "install_first_tool_file"
    );
    expect(installFirstToolCounterKey("tool_catalog_search")).toBe(
      "install_first_tool_search"
    );
    expect(installFirstToolCounterKey("get_current_time")).toBe(
      "install_first_tool_other"
    );
  });
});

describe("shellSplit — quoting-aware parse (audit R1 + review RV3)", () => {
  it("keeps quoted segments intact without the quotes", () => {
    expect(shellSplit('node -e "console.log(1)"')).toEqual([
      "node",
      "-e",
      "console.log(1)",
    ]);
    expect(shellSplit("echo 'two words' tail")).toEqual([
      "echo",
      "two words",
      "tail",
    ]);
  });

  it("unescapes \\\" and \\\\ inside double quotes (RV3)", () => {
    expect(shellSplit('node -e "console.log(\\"ready\\")"')).toEqual([
      "node",
      "-e",
      'console.log("ready")',
    ]);
  });

  it("returns null on an unterminated quote so the caller falls back", () => {
    expect(shellSplit("cd user's folder")).toBeNull();
  });

  it("collectCommandTemplates never produces an undefined executable (RV3)", async () => {
    const { collectCommandTemplatesWithEnv } = await import(
      "@/service/SkillInstallPlanner"
    );
    // Unterminated quote (stray apostrophe) previously produced a template
    // with executable === undefined; the whitespace fallback now keeps the
    // whole line reviewable.
    const templates = collectCommandTemplatesWithEnv(
      ["cd user's folder && python -m pip install -r requirements.txt"],
      []
    );
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(typeof t.executable).toBe("string");
      expect(t.executable.length).toBeGreaterThan(0);
    }
  });
});

describe("shell policy long-form flags + newline-exact operation match (RV5/RV6)", () => {
  const routing = classifySkillRequestIntent(
    "Set up https://github.com/browser-use/video-use for me"
  );

  it("blocks cp --recursive, cp -a, cp -R, and tar --extract (RV5)", () => {
    for (const command of [
      "cp --recursive video-use ~/.aifetchly/skills/video-use",
      "cp -a video-use ~/.aifetchly/skills/video-use",
      "cp -R video-use ~/.aifetchly/skills/video-use",
      "tar --extract -f bundle.tar",
      "tar --get -f bundle.tar",
    ] as const) {
      const verdict = evaluateSkillInstallationToolPolicy({
        routing,
        toolName: "shell_execute",
        toolArguments: { command },
      });
      expect(verdict.allowed, command).toBe(false);
    }
    // Benign commands stay legal.
    expect(
      evaluateSkillInstallationToolPolicy({
        routing,
        toolName: "shell_execute",
        toolArguments: { command: "cp a.txt b.txt" },
      }).allowed
    ).toBe(true);
  });

  it("a NEWLINE variant of an approved command is refused (RV6)", () => {
    const approved = {
      target: "https://github.com/browser-use/video-use",
      toolName: "shell_execute",
      operation: "git clone https://github.com/browser-use/video-use # npm install x",
    };
    // The exact single-line command passes.
    const exact = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command:
          "git clone https://github.com/browser-use/video-use # npm install x",
      },
      manualActionApproved: approved,
    });
    expect(exact.allowed).toBe(true);
    // A newline where the space was turns the comment into a SECOND
    // command — whitespace collapse used to authorize it.
    const newlineVariant = evaluateSkillInstallationToolPolicy({
      routing,
      toolName: "shell_execute",
      toolArguments: {
        command:
          "git clone https://github.com/browser-use/video-use #\nnpm install x",
      },
      manualActionApproved: approved,
    });
    expect(newlineVariant.allowed).toBe(false);
  });
});

describe("per-candidate command working directories (ticket D4b)", () => {
  it("commands carry their instruction file's directory; root files carry \"\"", async () => {
    const { collectCommandTemplates, instructionFileWorkingDirectory } =
      await import("@/service/SkillInstallPlanner");
    expect(instructionFileWorkingDirectory(undefined)).toBe("");
    expect(instructionFileWorkingDirectory("install.md")).toBe("");
    expect(instructionFileWorkingDirectory("nested/install.md")).toBe("nested");
    expect(instructionFileWorkingDirectory("skills/two/install.md")).toBe(
      "skills/two"
    );
    // Escapes fall back to the source root.
    expect(instructionFileWorkingDirectory("../evil/install.md")).toBe("");
    expect(instructionFileWorkingDirectory("/abs/install.md")).toBe("");

    const templates = collectCommandTemplates([
      {
        content: "pip install -r requirements.txt",
        relativePath: "install.md",
      },
      {
        content: "node setup.js",
        relativePath: "nested/install.md",
      },
    ]);
    const root = templates.find((t) => t.executable === "pip");
    expect(root?.workingDirectory).toBe("");
    const nested = templates.find((t) => t.executable === "node");
    expect(nested?.workingDirectory).toBe("nested");
  });
});
