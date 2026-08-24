/**
 * DB-backed tests for PromptSkillInvocationService + Module
 * (design §10.10, §21.3): idempotent same-hash invocation, changed-hash
 * revision behavior, install-mutation rejection, compaction reattachment
 * ordering, and conversation-scoped isolation.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { PromptSkillInvocationService } from "@/service/PromptSkillInvocationService";
import { PromptSkillInvocationModule } from "@/modules/PromptSkillInvocationModule";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import type { PromptSkillDefinition } from "@/entityTypes/promptSkillTypes";

const tmpDir = path.join(os.tmpdir(), "aifetchly-prompt-skill-invocation");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

const SKILL_MD =
  "---\nname: video-use\ndescription: Edit videos\n---\n\n# Usage\n\nUse ${AIFETCHLY_SKILL_DIR}/helpers.";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makeSkill(): PromptSkillDefinition {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "psinv-"));
  fs.writeFileSync(path.join(root, "SKILL.md"), SKILL_MD);
  return {
    runtimeId: "prompt:user:video-use-install",
    installationId: "video-use-install",
    sourceId: "user",
    scope: "user",
    name: "video-use",
    description: "Edit videos",
    canonicalRoot: root,
    skillMarkdownPath: path.join(root, "SKILL.md"),
    contentHash: sha256(SKILL_MD),
    manifest: {
      schemaVersion: 1,
      name: "video-use",
      description: "Edit videos",
      unknownFields: {},
    },
    enabled: true,
  };
}

async function resetCatalogWith(def: PromptSkillDefinition): Promise<void> {
  const catalog = getDefaultPromptSkillCatalog();
  catalog.replaceSource("user", []);
  catalog.replaceSource("user", [def]);
}

const OPTIONS = {
  conversationId: "conv-1",
  conversationWorkspaceRoot: "/ws/root",
  invocationSource: "model" as const,
};

describe("PromptSkillInvocationService", () => {
  it("returns loaded + attachment on first invocation and persists state", async () => {
    const def = makeSkill();
    await resetCatalogWith(def);
    const service = new PromptSkillInvocationService();
    const outcome = await service.invoke(
      { skill: "video-use" },
      { ...OPTIONS }
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("loaded");
    expect(outcome.result.runtimeId).toBe(def.runtimeId);
    expect(outcome.attachment).not.toBeNull();
    expect(outcome.attachment?.normalizedInstructions).toContain(
      "<invoked_prompt_skill"
    );

    const active = await service.listActiveInvocations("conv-1");
    expect(active).toHaveLength(1);
    expect(active[0].runtimeId).toBe(def.runtimeId);
  });

  it("same-hash repeated invocation is idempotent (already-loaded, no new attachment)", async () => {
    const def = makeSkill();
    await resetCatalogWith(def);
    const service = new PromptSkillInvocationService();
    const first = await service.invoke({ skill: "video-use" }, { ...OPTIONS });
    const second = await service.invoke({ skill: "video-use" }, { ...OPTIONS });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.status).toBe("already-loaded");
    expect(second.attachment).toBeNull();
    expect(second.result.contextRevision).toBe(first.result.contextRevision);

    const active = await service.listActiveInvocations("conv-1");
    expect(active).toHaveLength(1);
  });

  it("changed hash (linked skill edited) fails closed with a change notice", async () => {
    const def = makeSkill();
    await resetCatalogWith(def);
    const service = new PromptSkillInvocationService();
    const first = await service.invoke({ skill: "video-use" }, { ...OPTIONS });
    expect(first.ok).toBe(true);

    // External edit to the linked skill root.
    fs.appendFileSync(def.skillMarkdownPath, "\nNew instructions.");
    const second = await service.invoke({ skill: "video-use" }, { ...OPTIONS });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.result.code).toBe("SKILL_CONTEXT_HASH_MISMATCH");
  });

  it("rejects install/mutation requests (FR-27 boundary)", async () => {
    const def = makeSkill();
    await resetCatalogWith(def);
    const service = new PromptSkillInvocationService();
    const outcome = await service.invoke(
      { skill: "video-use", arguments: "please update the package" },
      { ...OPTIONS }
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.result.code).toBe("SKILL_INSTALL_MUTATION_REJECTED");
  });

  it("SKILL_NOT_FOUND for unknown names with no candidates", async () => {
    await resetCatalogWith(makeSkill());
    const service = new PromptSkillInvocationService();
    const outcome = await service.invoke(
      { skill: "does-not-exist" },
      { ...OPTIONS }
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.result.code).toBe("SKILL_NOT_FOUND");
  });

  it("disable-model-invocation blocks model selection but allows explicit", async () => {
    const base = makeSkill();
    const def: PromptSkillDefinition = {
      ...base,
      manifest: { ...base.manifest, disableModelInvocation: true },
    };
    await resetCatalogWith(def);
    const service = new PromptSkillInvocationService();

    const modelCall = await service.invoke(
      { skill: "video-use" },
      { ...OPTIONS, invocationSource: "model" }
    );
    expect(modelCall.ok).toBe(false);

    const explicitCall = await service.invoke(
      { skill: "video-use" },
      { ...OPTIONS, invocationSource: "explicit" }
    );
    expect(explicitCall.ok).toBe(true);
  });

  it("invocation state is scoped per conversation (no cross-talk)", async () => {
    const def = makeSkill();
    await resetCatalogWith(def);
    const service = new PromptSkillInvocationService();
    await service.invoke(
      { skill: "video-use" },
      { ...OPTIONS, conversationId: "conv-a" }
    );
    const otherConv = await service.listActiveInvocations("conv-b");
    expect(otherConv).toHaveLength(0);
  });
});

describe("PromptSkillInvocationModule", () => {
  it("deleteByConversation clears state through the Model layer", async () => {
    const def = makeSkill();
    await resetCatalogWith(def);
    const module = new PromptSkillInvocationModule();
    const service = new PromptSkillInvocationService();
    await service.invoke({ skill: "video-use" }, { ...OPTIONS });
    expect(await module.listActive("conv-1")).toHaveLength(1);
    const removed = await module.deleteByConversation("conv-1");
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await module.listActive("conv-1")).toHaveLength(0);
  });

  it("a new content hash creates a new revision and supersedes the old record", async () => {
    const def = makeSkill();
    await resetCatalogWith(def);
    const module = new PromptSkillInvocationModule();
    const base = {
      conversationId: "conv-rev",
      agentScope: "",
      runtimeId: def.runtimeId,
      normalizedInstructions: "v1",
      tokenEstimate: 1,
      invocationArgumentsJson: "{}",
      invocationSource: "model" as const,
      invokedAt: new Date(),
    };
    await module.recordInvocation({ ...base, contentHash: "hash-1" });
    const second = await module.recordInvocation({
      ...base,
      contentHash: "hash-2",
      normalizedInstructions: "v2",
    });
    expect(second.alreadyActive).toBe(false);
    expect(second.entity.contextRevision).toBe(2);
    const active = await module.listActive("conv-rev");
    expect(active).toHaveLength(1);
    expect(active[0].contentHash).toBe("hash-2");
    expect(active[0].normalizedInstructions).toBe("v2");
  });
});
