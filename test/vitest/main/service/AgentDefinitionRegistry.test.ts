/**
 * AGT-01 (Phase 16) — AgentDefinitionRegistry lookup order + replaceSource.
 *
 * This registry is a STRUCTURAL CLONE of CommandRegistry (Phase 13-02) with
 * ONE INTENTIONAL DIVERGENCE: the D-Precedence rank order — agents rank
 * user (1) ABOVE workspace (2), whereas commands rank workspace above user.
 * A load-bearing comment on the SOURCE_RANK map cites AGT-01 / tech-design
 * §7.4 so a future reader does not "normalize" it to match CommandRegistry.
 *
 * Covered behaviors:
 *   - Construction seeds built-ins into the registry itself (RESEARCH Pitfall 1).
 *   - listBuiltIns() shape is preserved for AgentDefinitionModule.ensureBuiltIns.
 *   - D-Precedence: built-in > user > workspace > plugin; built-ins unshadowable.
 *   - replaceSource atomically reconciles add/change/delete/rename.
 *   - Every accessor returns defensive copies (CLAUDE.md immutability).
 *
 * Pure unit tests — no mocks, no IPC, no Electron, no DB.
 */
import { describe, expect, it } from "vitest";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import {
  AgentDefinitionRegistryImpl,
  AgentDefinitionRegistry,
} from "@/service/AgentDefinitionRegistry";

// --- Fixtures ----------------------------------------------------------------

function makeAgent(
  overrides: Partial<AgentDefinitionView> &
    Pick<AgentDefinitionView, "id" | "name">
): AgentDefinitionView {
  return {
    description: `${overrides.name} agent`,
    version: 1,
    systemPrompt: `prompt for ${overrides.id}`,
    allowedTools: [],
    mode: "specialist",
    maxToolCalls: 8,
    maxRuntimeMs: 180000,
    maxContinueCalls: 8,
    outputSchema: {},
    status: "active",
    ...overrides,
  };
}

const userDup = makeAgent({
  id: "user:agent:dup",
  name: "dup",
  description: "user dup",
});
const workspaceDup = makeAgent({
  id: "workspace:ws1:agent:dup",
  name: "dup",
  description: "workspace dup",
});
const pluginDup = makeAgent({
  id: "plugin:demo:agent:dup",
  name: "dup",
  description: "plugin dup",
});
const userLead = makeAgent({
  id: "user:agent:lead-research",
  name: "lead-research",
  description: "user lead",
});
const userShadowBuiltin = makeAgent({
  // Same NAME as the built-in ("Lead Researcher") but a scoped user ID.
  id: "user:agent:lead-researcher",
  name: "Lead Researcher",
  description: "user attempts to shadow built-in",
});

// --- Construction + built-ins (RESEARCH Pitfall 1) --------------------------

describe("AgentDefinitionRegistry construction + built-ins", () => {
  it("a fresh registry seeds built-ins so registry-first getById finds them", () => {
    const r = new AgentDefinitionRegistryImpl();
    // The built-in lead-researcher must be resolvable WITHOUT hitting the DB.
    const found = r.getById("agent-lead-researcher");
    expect(found).not.toBeNull();
    expect(found?.mode).toBe("specialist");
    expect(found?.allowedTools.length).toBeGreaterThan(0);
  });

  it("listBuiltIns() returns active built-ins with stable shape (ensureBuiltIns contract)", () => {
    const r = new AgentDefinitionRegistryImpl();
    const builtIns = r.listBuiltIns();
    expect(builtIns.length).toBeGreaterThan(0);
    for (const d of builtIns) {
      expect(d.status).toBe("active");
      expect(d.id.startsWith("agent-")).toBe(true);
      expect(d.outputSchema).toBeDefined();
      expect(d.systemPrompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("listBuiltIns() is independent of replaceSource mutations", () => {
    const r = new AgentDefinitionRegistryImpl();
    const before = r.listBuiltIns().length;
    r.replaceSource("user", [userLead]);
    // listBuiltIns is a fixed built-in catalog, not affected by user mutation.
    expect(r.listBuiltIns().length).toBe(before);
  });

  it("list() on a fresh registry includes the built-in(s)", () => {
    const r = new AgentDefinitionRegistryImpl();
    const ids = r.list().map((d) => d.id);
    expect(ids).toContain("agent-lead-researcher");
  });
});

// --- AGT-01 D-Precedence (user wins over workspace — INTENTIONAL divergence) --

describe("AgentDefinitionRegistry D-Precedence (AGT-01)", () => {
  // D-Precedence: agents rank USER (1) above WORKSPACE (2). This is the
  // OPPOSITE of CommandRegistry (commands rank workspace above user). The
  // divergence is mandated by AGT-01 / tech-design §7.4 — see the load-bearing
  // comment on SOURCE_RANK in AgentDefinitionRegistry.ts. DO NOT "fix" this
  // to match commands.

  it("user wins over workspace on a bare-name lookup (AGT-01 D-Precedence)", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("workspace:ws1", [workspaceDup]);
    r.replaceSource("user", [userDup]);
    // Bare-name fallback resolves the USER entry (rank 1 beats rank 2).
    const resolved = r.getById("dup");
    expect(resolved?.id).toBe("user:agent:dup");
  });

  it("built-in beats user and workspace (built-ins unshadowable)", () => {
    const r = new AgentDefinitionRegistryImpl();
    // Register user + workspace agents whose NAME collides with the built-in.
    const userBuiltinName = makeAgent({
      id: "user:agent:lead-researcher",
      name: "Lead Researcher",
    });
    const wsBuiltinName = makeAgent({
      id: "workspace:ws1:agent:lead-researcher",
      name: "Lead Researcher",
    });
    r.replaceSource("user", [userBuiltinName]);
    r.replaceSource("workspace:ws1", [wsBuiltinName]);
    // The built-in was seeded at construction; a bare-name lookup must resolve
    // to the built-in ID, NOT the user/workspace shadow.
    const resolved = r.getById("Lead Researcher");
    expect(resolved?.id).toBe("agent-lead-researcher");
  });

  it("workspace wins over plugin when no built-in/user entry exists", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("plugin:demo", [pluginDup]);
    r.replaceSource("workspace:ws1", [workspaceDup]);
    expect(r.getById("dup")?.id).toBe("workspace:ws1:agent:dup");
  });

  it("user wins over plugin when no built-in/workspace entry exists", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("plugin:demo", [pluginDup]);
    r.replaceSource("user", [userDup]);
    expect(r.getById("dup")?.id).toBe("user:agent:dup");
  });

  it("a source registering a built-in-named agent CANNOT shadow the built-in", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("user", [userShadowBuiltin]);
    expect(r.getById("Lead Researcher")?.id).toBe("agent-lead-researcher");
    // The user entry is still reachable by its exact scoped ID.
    expect(r.getById("user:agent:lead-researcher")?.id).toBe(
      "user:agent:lead-researcher"
    );
  });

  it("returns null for unknown names and ids", () => {
    const r = new AgentDefinitionRegistryImpl();
    expect(r.getById("does-not-exist")).toBeNull();
    expect(r.getById("user:agent:nope")).toBeNull();
  });
});

// --- replaceSource atomic reconciliation (mirror CommandRegistry) ------------

describe("AgentDefinitionRegistry replaceSource atomic reconciliation", () => {
  it("removes entries that are no longer in the new list (delete)", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("user", [userDup, userLead]);
    expect(r.getById("user:agent:lead-research")).not.toBeNull();
    r.replaceSource("user", [userDup]); // lead-research dropped
    expect(r.getById("user:agent:lead-research")).toBeNull();
    expect(r.list().filter((d) => d.name === "lead-research")).toHaveLength(0);
    // The surviving entry is unaffected.
    expect(r.getById("user:agent:dup")?.id).toBe("user:agent:dup");
  });

  it("atomically handles rename: old name disappears, new name appears", () => {
    const r = new AgentDefinitionRegistryImpl();
    const v1 = makeAgent({
      id: "user:agent:lead-research",
      name: "lead-research",
    });
    r.replaceSource("user", [v1]);
    expect(r.getById("lead-research")?.id).toBe("user:agent:lead-research");

    const v2 = makeAgent({
      id: "user:agent:research-lead", // new scoped ID
      name: "research-lead",
    });
    r.replaceSource("user", [v2]);
    expect(r.getById("lead-research")).toBeNull();
    expect(r.getById("research-lead")?.id).toBe("user:agent:research-lead");
    // The old scoped ID is gone too.
    expect(r.getById("user:agent:lead-research")).toBeNull();
  });

  it("replacing with an empty list removes every entry for that source", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("user", [userDup, userLead]);
    r.replaceSource("user", []);
    expect(r.getById("user:agent:dup")).toBeNull();
    expect(r.getById("user:agent:lead-research")).toBeNull();
  });

  it("does not affect other sources when reconciling one", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("workspace:ws1", [workspaceDup]);
    r.replaceSource("user", [userDup, userLead]);
    r.replaceSource("user", [userDup]); // only user changes
    expect(r.getById("workspace:ws1:agent:dup")).not.toBeNull();
  });

  it("rebuilds the name index after replacement so the winner is up-to-date", () => {
    const r = new AgentDefinitionRegistryImpl();
    // User wins initially (no built-in named "dup").
    r.replaceSource("workspace:ws1", [workspaceDup]);
    r.replaceSource("user", [userDup]);
    expect(r.getById("dup")?.id).toBe("user:agent:dup");
    // Remove the user source entirely — workspace should now win.
    r.replaceSource("user", []);
    expect(r.getById("dup")?.id).toBe("workspace:ws1:agent:dup");
  });

  it("stores defensive copies of replaced entries (immutability)", () => {
    const r = new AgentDefinitionRegistryImpl();
    const input = { ...userDup };
    r.replaceSource("user", [input]);
    (input as { systemPrompt?: string }).systemPrompt = "TAMPERED";
    expect(r.getById("user:agent:dup")?.systemPrompt).toBe(
      "prompt for user:agent:dup"
    );
  });
});

// --- Immutability / defensive copies (CLAUDE.md rule) -----------------------

describe("AgentDefinitionRegistry defensive copies", () => {
  it("getById returns a defensive copy — mutating it does not affect the registry", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("user", [userDup]);
    const a = r.getById("user:agent:dup");
    const b = r.getById("user:agent:dup");
    expect(a).not.toBe(b); // different references
    expect(a).toEqual(b); // same content
  });

  it("list() returns defensive copies — mutating output does not affect the registry", () => {
    const r = new AgentDefinitionRegistryImpl();
    r.replaceSource("user", [userDup]);
    const list1 = r.list();
    const userEntry = list1.find((d) => d.id === "user:agent:dup");
    // find() returns possibly-undefined; we know userDup is registered, so
    // assert non-undefined before mutating to keep tsc strict happy.
    expect(userEntry).toBeDefined();
    (userEntry as { systemPrompt?: string }).systemPrompt = "EVIL";
    const list2 = r.list();
    const again = list2.find((d) => d.id === "user:agent:dup");
    expect(again?.systemPrompt).toBe("prompt for user:agent:dup");
  });

  it("listBuiltIns() returns defensive copies — mutating output does not affect future calls", () => {
    const r = new AgentDefinitionRegistryImpl();
    const list1 = r.listBuiltIns();
    (list1[0] as { systemPrompt?: string }).systemPrompt = "EVIL";
    const list2 = r.listBuiltIns();
    expect(list2[0].systemPrompt).not.toBe("EVIL");
  });

  it("replaceSource stores a defensive copy — mutating the input array afterwards is a no-op", () => {
    const r = new AgentDefinitionRegistryImpl();
    const input: AgentDefinitionView[] = [{ ...userDup }];
    r.replaceSource("user", input);
    // Mutate the input array + entry after registration.
    input.push({ ...userLead });
    (input[0] as { name?: string }).name = "tampered";
    expect(
      r.list().filter((d) => d.id === "user:agent:lead-research")
    ).toHaveLength(0);
    expect(r.getById("user:agent:dup")?.name).toBe("dup");
  });
});

// --- Backward-compat singleton (AgentDefinitionModule.ensureBuiltIns path) ---

describe("AgentDefinitionRegistry singleton (backward-compat)", () => {
  it("exports a ready-made singleton with built-ins seeded (legacy import path)", () => {
    // AgentDefinitionModule.ensureBuiltIns consumes this exact symbol.
    expect(AgentDefinitionRegistry.listBuiltIns().length).toBeGreaterThan(0);
    expect(
      AgentDefinitionRegistry.getById("agent-lead-researcher")
    ).not.toBeNull();
  });
});
