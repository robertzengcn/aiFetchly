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
import { evaluateSkillInstallationToolPolicy } from "@/service/SkillInstallationToolPolicy";
import {
  shouldHydrateAndReplay,
  HydrationReplayLedger,
  decideDeferredToolHydration,
  stableToolCallFingerprint,
} from "@/service/DeferredToolHydrationCoordinator";

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

  it("permits a generic fallback after a typed manual-action approval", () => {
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
