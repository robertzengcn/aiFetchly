/**
 * Tests for the credential binding persistence (TODO 9 / design §14.1/§20.3):
 * SkillCredentialBindingEntity + SkillCredentialModule — opaque binding rows
 * in SQLite, fail-closed value store, two-store consistency on store and
 * delete.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { SkillCredentialModule } from "@/modules/SkillCredentialModule";
import { SkillCredentialBindingModel } from "@/model/SkillCredentialBinding.model";

const tmpDir = path.join(os.tmpdir(), "aifetchly-credential-binding");

// safeStorage is unavailable in tests → SkillCredentialService.store fails
// closed. For binding-row semantics we stub the underlying service.
const storeStub = vi.hoisted(() => ({
  storeMap: new Map<string, string>(),
}));
vi.mock("@/service/SkillCredentialService", () => ({
  SkillCredentialService: class {
    store(installationId: string, envVar: string, value: string) {
      storeStub.storeMap.set(`${installationId}:${envVar}`, value);
      return { ok: true as const };
    }
    retrieve(installationId: string, envVar: string) {
      return storeStub.storeMap.get(`${installationId}:${envVar}`) ?? null;
    }
    delete(installationId: string) {
      let removed = 0;
      for (const key of [...storeStub.storeMap.keys()]) {
        if (key.startsWith(`${installationId}:`)) {
          storeStub.storeMap.delete(key);
          removed += 1;
        }
      }
      return removed;
    }
  },
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
  storeStub.storeMap.clear();
});

describe("SkillCredentialModule binding persistence (TODO 9)", () => {
  it("store writes BOTH the encrypted value and the opaque binding row", async () => {
    const module = new SkillCredentialModule();
    const result = await module.store(
      "inst-9",
      "ELEVENLABS_API_KEY",
      "sk-value-never-in-sqlite"
    );
    expect(result.ok).toBe(true);

    // Value side (stubbed store).
    expect(storeStub.storeMap.get("inst-9:ELEVENLABS_API_KEY")).toBe(
      "sk-value-never-in-sqlite"
    );
    // Binding side (real SQLite): names + opaque ref, NEVER the value.
    const model = new SkillCredentialBindingModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    );
    const rows = await model.listByInstallation("inst-9");
    expect(rows).toHaveLength(1);
    expect(rows[0].environmentVariable).toBe("ELEVENLABS_API_KEY");
    expect(rows[0].bindingRef).toBe("inst-9:ELEVENLABS_API_KEY");
    expect(rows[0].status).toBe("configured");
    expect(JSON.stringify(rows)).not.toContain("sk-value-never-in-sqlite");
  });

  it("re-storing the same variable upserts one row, not duplicates", async () => {
    const module = new SkillCredentialModule();
    await module.store("inst-9", "TOKEN_A", "v1");
    await module.store("inst-9", "TOKEN_A", "v2");
    const model = new SkillCredentialBindingModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    );
    const rows = await model.listByInstallation("inst-9");
    expect(rows).toHaveLength(1);
    // The store holds the LATEST value.
    expect(module.retrieve("inst-9", "TOKEN_A")).toBe("v2");
  });

  it("listBindings exposes names + status, never values", async () => {
    const module = new SkillCredentialModule();
    await module.store("inst-9", "TOKEN_B", "sk-secret-b");
    const views = await module.listBindings("inst-9");
    expect(views).toHaveLength(1);
    expect(views[0].environmentVariable).toBe("TOKEN_B");
    expect(views[0].status).toBe("configured");
    expect(JSON.stringify(views)).not.toContain("sk-secret-b");
  });

  it("deleteAll removes values AND binding rows together", async () => {
    const module = new SkillCredentialModule();
    await module.store("inst-9", "TOKEN_C", "v");
    await module.store("inst-9", "TOKEN_D", "v");
    const removed = await module.deleteAll("inst-9");
    expect(removed).toBe(2);
    expect(storeStub.storeMap.has("inst-9:TOKEN_C")).toBe(false);
    expect(storeStub.storeMap.has("inst-9:TOKEN_D")).toBe(false);
    const model = new SkillCredentialBindingModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    );
    expect(await model.listByInstallation("inst-9")).toHaveLength(0);
  });

  it("a fail-closed value store writes NO binding row (two stores agree)", async () => {
    // Simulate safeStorage refusal: make the stub throw once.
    const originalSet = storeStub.storeMap.set.bind(storeStub.storeMap);
    storeStub.storeMap.set = () => {
      throw new Error("safeStorage unavailable");
    };
    const module = new SkillCredentialModule();
    const result = await module.store("inst-9", "TOKEN_E", "v");
    // Restore for cleanup.
    storeStub.storeMap.set = originalSet;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("unavailable");
    const model = new SkillCredentialBindingModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    );
    expect(await model.listByInstallation("inst-9")).toHaveLength(0);
  });
});
