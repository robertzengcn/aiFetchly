/**
 * CMD-01, CMD-07 — CommandRegistry lookup order + replaceSource + ranking.
 *
 * Lookup order: built-in > workspace > user > plugin.
 * replaceSource atomically reconciles add/change/delete/rename and
 * rebuilds the name index so stale entries never survive.
 * listViews strips the prompt body (renderer-safe projection).
 *
 * Pure unit tests — no mocks, no IPC, no Electron.
 */
import { describe, expect, it } from "vitest";
import type {
  SlashCommandDefinition,
  SlashCommandView,
} from "@/entityTypes/slashCommandTypes";
import {
  CommandRegistry,
  rankSuggestions,
} from "@/service/slashCommands/CommandRegistry";

// --- Fixtures ----------------------------------------------------------------

function makeCmd(
  overrides: Partial<SlashCommandDefinition> &
    Pick<SlashCommandDefinition, "id" | "name" | "source" | "sourceId">
): SlashCommandDefinition {
  return {
    description: `${overrides.name} command`,
    aliases: [],
    type: "prompt",
    sourceLabel: overrides.source ?? "User",
    requiresTrust: false,
    enabled: true,
    body: `body for ${overrides.id}`,
    metadata: { note: "fixture" },
    ...overrides,
  };
}

const builtinReview = makeCmd({
  id: "built-in:command:review",
  name: "review",
  source: "built-in",
  sourceId: "built-in",
  sourceLabel: "Built-in",
});
const workspaceReview = makeCmd({
  id: "workspace:42:command:review",
  name: "review",
  source: "workspace",
  sourceId: "workspace:42",
  sourceLabel: "Workspace",
});
const userReview = makeCmd({
  id: "user:command:review",
  name: "review",
  source: "user",
  sourceId: "user",
  sourceLabel: "User",
});
const pluginReview = makeCmd({
  id: "plugin:demo:command:review",
  name: "review",
  source: "plugin",
  sourceId: "plugin:demo",
  sourceLabel: "Plugin",
});
const leadCmd = makeCmd({
  id: "user:command:lead-research",
  name: "lead-research",
  source: "user",
  sourceId: "user",
  sourceLabel: "User",
});

// --- CMD-01 lookup order -----------------------------------------------------

describe("CommandRegistry lookup order (CMD-01)", () => {
  it.each([
    {
      label: "built-in beats user",
      register: [userReview, builtinReview],
      expectedId: "built-in:command:review",
    },
    {
      label: "built-in beats workspace and plugin",
      register: [pluginReview, workspaceReview, builtinReview],
      expectedId: "built-in:command:review",
    },
    {
      label: "workspace beats user",
      register: [userReview, workspaceReview],
      expectedId: "workspace:42:command:review",
    },
    {
      label: "user beats plugin",
      register: [pluginReview, userReview],
      expectedId: "user:command:review",
    },
    {
      label: "workspace beats plugin when no built-in/user",
      register: [pluginReview, workspaceReview],
      expectedId: "workspace:42:command:review",
    },
  ])("$label", ({ register, expectedId }) => {
    const r = new CommandRegistry();
    for (const c of register) r.register(c);
    expect(r.getByName("review")?.id).toBe(expectedId);
  });

  it("built-in cannot be shadowed by re-registering the user name first", () => {
    const r = new CommandRegistry();
    r.register(userReview);
    r.register(builtinReview);
    // Even though user was registered first, built-in must win on lookup.
    expect(r.getByName("review")?.id).toBe("built-in:command:review");
  });

  it("returns null for unknown names", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    expect(r.getByName("nonexistent")).toBeNull();
  });

  it("returns null for unknown ids", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    expect(r.getById("built-in:command:nope")).toBeNull();
  });
});

// --- Immutability (CLAUDE.md rule) ------------------------------------------

describe("CommandRegistry defensive copies", () => {
  it("register() stores a defensive copy — mutating input afterwards is a no-op", () => {
    const r = new CommandRegistry();
    const input = { ...builtinReview };
    r.register(input);
    // Mutate the original input object after registration.
    (input as { body?: string }).body = "TAMPERED";
    (input as { name?: string }).name = "tampered";
    const stored = r.getById(builtinReview.id);
    expect(stored?.body).toBe("body for built-in:command:review");
    expect(stored?.name).toBe("review");
    // Name index still resolves the original name.
    expect(r.getByName("review")?.id).toBe(builtinReview.id);
    expect(r.getByName("tampered")).toBeNull();
  });

  it("getById returns a defensive copy — mutating it does not affect the registry", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    const view1 = r.getById(builtinReview.id);
    const view2 = r.getById(builtinReview.id);
    expect(view1).not.toBe(view2); // different references
    expect(view1).toEqual(view2); // same content
  });

  it("getByName returns a defensive copy", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    const a = r.getByName("review");
    const b = r.getByName("review");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("list() returns defensive copies — mutating output does not affect registry", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    const list1 = r.list();
    (list1[0] as { body?: string }).body = "EVIL";
    const list2 = r.list();
    expect(list2[0].body).toBe("body for built-in:command:review");
  });
});

// --- replaceSource: atomic reconciliation (CMD-01 §7.3) ---------------------

describe("replaceSource atomic reconciliation (CMD-01)", () => {
  it("removes commands that are no longer in the new list (delete)", () => {
    const r = new CommandRegistry();
    r.replaceSource("user", [userReview, leadCmd]);
    expect(r.getById("user:command:lead-research")).not.toBeNull();
    r.replaceSource("user", [userReview]); // lead-research dropped
    expect(r.getById("user:command:lead-research")).toBeNull();
    expect(r.list().filter((c) => c.name === "lead-research")).toHaveLength(0);
    // The surviving command is unaffected.
    expect(r.getById("user:command:review")?.id).toBe("user:command:review");
  });

  it("atomically handles rename: old name disappears, new name appears, no stale leftover", () => {
    const r = new CommandRegistry();
    const v1 = makeCmd({
      id: "user:command:lead-research",
      name: "lead-research",
      source: "user",
      sourceId: "user",
    });
    r.replaceSource("user", [v1]);
    expect(r.getByName("lead-research")?.id).toBe("user:command:lead-research");

    const v2 = makeCmd({
      id: "user:command:lead-research", // same ID, different name
      name: "research-lead",
      source: "user",
      sourceId: "user",
    });
    r.replaceSource("user", [v2]);
    expect(r.getByName("lead-research")).toBeNull();
    expect(r.getByName("research-lead")?.id).toBe("user:command:lead-research");
    // No stale leftover entry under either name.
    expect(r.list().filter((c) => c.name === "lead-research")).toHaveLength(0);
  });

  it("handles missed-events: replacing with empty list removes all of source's commands", () => {
    const r = new CommandRegistry();
    r.replaceSource("user", [userReview, leadCmd]);
    r.replaceSource("user", []);
    expect(r.list()).toHaveLength(0);
    expect(r.getById("user:command:review")).toBeNull();
  });

  it("does not affect other sources when reconciling one", () => {
    const r = new CommandRegistry();
    r.replaceSource("built-in", [builtinReview]);
    r.replaceSource("user", [userReview, leadCmd]);
    r.replaceSource("user", [userReview]); // only user changes
    expect(r.getById("built-in:command:review")).not.toBeNull();
    expect(r.getByName("review")?.id).toBe("built-in:command:review");
  });

  it("rebuilds the name index after replacement so the winner is up-to-date", () => {
    const r = new CommandRegistry();
    // Built-in wins initially.
    r.replaceSource("built-in", [builtinReview]);
    r.replaceSource("user", [userReview]);
    expect(r.getByName("review")?.id).toBe("built-in:command:review");
    // Remove the built-in source entirely — user should now win.
    r.replaceSource("built-in", []);
    expect(r.getByName("review")?.id).toBe("user:command:review");
  });

  it("stores defensive copies of replaced commands (immutability)", () => {
    const r = new CommandRegistry();
    const input = { ...userReview };
    r.replaceSource("user", [input]);
    (input as { body?: string }).body = "TAMPERED";
    expect(r.getById("user:command:review")?.body).toBe(
      "body for user:command:review"
    );
  });
});

// --- register / unregister ---------------------------------------------------

describe("register / unregister", () => {
  it("register adds a command resolvable by id and name", () => {
    const r = new CommandRegistry();
    r.register(leadCmd);
    expect(r.getById("user:command:lead-research")?.name).toBe("lead-research");
    expect(r.getByName("lead-research")?.id).toBe("user:command:lead-research");
  });

  it("unregister removes a command from both indexes", () => {
    const r = new CommandRegistry();
    r.register(leadCmd);
    r.unregister("user:command:lead-research");
    expect(r.getById("user:command:lead-research")).toBeNull();
    expect(r.getByName("lead-research")).toBeNull();
  });

  it("unregister of unknown id is a no-op", () => {
    const r = new CommandRegistry();
    r.register(leadCmd);
    expect(() => r.unregister("does:not:exist")).not.toThrow();
    expect(r.list()).toHaveLength(1);
  });
});

// --- listViews: renderer-safe projection (T-13-Leak) ------------------------

describe("listViews() (T-13-Leak mitigation)", () => {
  it("omits the body field from every entry", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    r.register(userReview);
    const views = r.listViews();
    expect(views).toHaveLength(2);
    for (const v of views) {
      expect("body" in v).toBe(false);
    }
  });

  it("omits arbitrary metadata from every entry", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    const views = r.listViews();
    for (const v of views) {
      expect("metadata" in v).toBe(false);
    }
  });

  it("includes renderer-safe fields (id, name, description, source, sourceLabel, aliases)", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    const v = r.listViews()[0];
    expect(v.id).toBe(builtinReview.id);
    expect(v.name).toBe("review");
    expect(v.source).toBe("built-in");
    expect(v.sourceLabel).toBe("Built-in");
    expect(v.enabled).toBe(true);
  });

  it("returns defensive copies — mutating output does not affect the registry", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    const list1 = r.listViews();
    (list1[0] as { name?: string }).name = "EVIL";
    const list2 = r.listViews();
    expect(list2[0].name).toBe("review");
  });
});

// --- CMD-07 suggestion ranking ----------------------------------------------

describe("rankSuggestions (CMD-07)", () => {
  function view(
    name: string,
    extras: Partial<SlashCommandView> = {}
  ): SlashCommandView {
    // Spread extras LAST so callers can override any base field
    // (notably `description`, which the substring test relies on).
    return {
      id: `id:${name}`,
      name,
      description: `${name} description`,
      aliases: [],
      source: "user",
      sourceLabel: "User",
      enabled: true,
      ...extras,
    };
  }

  it("ranks exact name higher than exact alias", () => {
    const cmds = [
      view("review", { aliases: ["rev"] }), // exact alias match only
      view("rev"), // exact name match
    ];
    const ranked = rankSuggestions("rev", cmds);
    expect(ranked[0].name).toBe("rev");
  });

  it("ranks exact alias higher than prefix name", () => {
    const cmds = [
      view("review-long"), // prefix name only
      view("review", { aliases: ["rev"] }), // exact alias
    ];
    const ranked = rankSuggestions("rev", cmds);
    expect(ranked[0].name).toBe("review");
  });

  it("ranks prefix name higher than prefix alias", () => {
    // Query "alph" is a PREFIX of "alphabet" (name) and "alphax" (alias),
    // but NOT an exact match for any name or alias.
    const cmds = [
      view("zzz", { aliases: ["alphax"] }), // prefix alias only
      view("alphabet"), // prefix name only
    ];
    const ranked = rankSuggestions("alph", cmds);
    expect(ranked[0].name).toBe("alphabet");
  });

  it("ranks prefix alias higher than substring description", () => {
    const cmds = [
      view("zzz", { description: "alpha mention" }), // substring description
      view("aaa", { aliases: ["alphabet-x"] }), // prefix alias
    ];
    const ranked = rankSuggestions("alpha", cmds);
    expect(ranked[0].name).toBe("aaa");
  });

  it("ranks substring description above non-matches", () => {
    const cmds = [
      view("zzz", { description: "no match here" }),
      view("aaa", { description: "helps with review workflows" }),
    ];
    const ranked = rankSuggestions("review", cmds);
    expect(ranked[0].name).toBe("aaa");
  });

  it("is case-insensitive", () => {
    const cmds = [view("Review"), view("reviewer")];
    expect(rankSuggestions("REVIEW", cmds)[0].name).toBe("Review");
    expect(rankSuggestions("review", cmds)[0].name).toBe("Review");
  });

  it("is stable — equal scores preserve input order", () => {
    const cmds = [
      view("aaa", { description: "x review" }),
      view("bbb", { description: "y review" }),
      view("ccc", { description: "z review" }),
    ];
    const ranked = rankSuggestions("review", cmds);
    expect(ranked.map((c) => c.name)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("returns empty query unchanged (all commands, no scoring)", () => {
    const cmds = [view("aaa"), view("bbb")];
    const ranked = rankSuggestions("", cmds);
    expect(ranked.map((c) => c.name)).toEqual(["aaa", "bbb"]);
  });
});
