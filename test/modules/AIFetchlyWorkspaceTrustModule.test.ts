// test/modules/AIFetchlyWorkspaceTrustModule.test.ts
// Phase 17-01 (TRS-02) — persisted per-capability workspace trust.
//
// Exercises the live `aifetchly_workspace_trust` table (created via
// synchronize:true once AIFetchlyWorkspaceTrustEntity is registered in
// SqliteDb), the Model upsert/getByRootHash/listAll CRUD, the Module
// getTrust/setTrust/ensureMigrationSeed surface, and the SHA-256 root-hash
// keying (A1). Follows the AgentDefinitionModule.test.ts mocha+chai shape.
import { expect } from "chai";
import { describe, it, before } from "mocha";
import { AIFetchlyWorkspaceTrustModule } from "@/modules/AIFetchlyWorkspaceTrustModule";
import {
  AIFetchlyWorkspaceTrustModel,
  computeWorkspaceRootHash,
  normalizeWorkspaceRoot,
} from "@/model/AIFetchlyWorkspaceTrust.model";
import { WorkspaceModule } from "@/modules/WorkspaceModule";
import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";

const ALL_TRUE: AIFetchlySourceTrust = {
  instructions: true,
  commands: true,
  agents: true,
  hooks: true,
  skills: true,
};

const HOOKS_ONLY: AIFetchlySourceTrust = {
  instructions: false,
  commands: false,
  agents: false,
  hooks: true,
  skills: false,
};

// Unique suffix per process/run so repeated runs against the persistent temp
// DB never collide with rows from prior runs (AgentDefinitionModule.test.ts
// follows the same "no cross-run cleanup needed" convention).
const RUN_ID = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
function uniquePath(label: string): string {
  return `/tmp/aifetchly-trust-test-${RUN_ID}/${label}`;
}
function uniqueConversationId(label: string): string {
  return `conv-trust-${RUN_ID}-${label}`;
}

describe("AIFetchlyWorkspaceTrustModule", () => {
  let module: AIFetchlyWorkspaceTrustModule;
  // Model backed by the same temp DB (BaseDb resolves an empty path to the
  // shared aifetchly-test tmpdir, the same one BaseModule uses).
  let model: AIFetchlyWorkspaceTrustModel;

  before(() => {
    module = new AIFetchlyWorkspaceTrustModule();
    model = new AIFetchlyWorkspaceTrustModel("");
  });

  it("persists and reads back all-true flags (entity round-trip)", async () => {
    const rootPath = uniquePath("roundtrip");
    const hash = computeWorkspaceRootHash(rootPath);
    await module.setTrust(hash, rootPath, ALL_TRUE);
    const trust = await module.getTrust(hash);
    expect(trust).to.not.be.null;
    expect(trust).to.deep.equal(ALL_TRUE);
  });

  it("persists per-capability flags independently", async () => {
    const rootPath = uniquePath("hooks-only");
    const hash = computeWorkspaceRootHash(rootPath);
    await module.setTrust(hash, rootPath, HOOKS_ONLY);
    const trust = await module.getTrust(hash);
    expect(trust).to.deep.equal(HOOKS_ONLY);
    expect(trust?.hooks).to.equal(true);
    expect(trust?.instructions).to.equal(false);
    expect(trust?.agents).to.equal(false);
    expect(trust?.skills).to.equal(false);
    expect(trust?.commands).to.equal(false);
  });

  it("upserts by workspaceRootHash without duplicating (unique constraint)", async () => {
    const rootPath = uniquePath("upsert-twice");
    const hash = computeWorkspaceRootHash(rootPath);
    await module.setTrust(hash, rootPath, HOOKS_ONLY);
    await module.setTrust(hash, rootPath, ALL_TRUE);

    const rowsForHash = (await model.listAll()).filter(
      (e) => e.workspaceRootHash === hash
    );
    expect(rowsForHash.length).to.equal(1);
    // Second write wins (update in place).
    const trust = await module.getTrust(hash);
    expect(trust).to.deep.equal(ALL_TRUE);
  });

  it("returns null for an unknown root hash (fail-closed)", async () => {
    const trust = await module.getTrust(
      computeWorkspaceRootHash(uniquePath("never-set"))
    );
    expect(trust).to.be.null;
  });

  it("keys rows by SHA-256 of the normalized root path (A1)", async () => {
    const rootPath = uniquePath("normalize-keying");
    const hash = computeWorkspaceRootHash(rootPath);
    await module.setTrust(hash, rootPath, ALL_TRUE);

    // A trailing slash normalizes away -> same hash, same row.
    const trailingSlashPath = `${rootPath}/`;
    expect(normalizeWorkspaceRoot(trailingSlashPath)).to.equal(
      normalizeWorkspaceRoot(rootPath)
    );
    expect(computeWorkspaceRootHash(trailingSlashPath)).to.equal(hash);

    const trust = await module.getTrust(computeWorkspaceRootHash(rootPath));
    expect(trust).to.deep.equal(ALL_TRUE);
  });

  it("survives a module reconstruction from the same DB (SC3 restart-safe)", async () => {
    const rootPath = uniquePath("restart-safe");
    const hash = computeWorkspaceRootHash(rootPath);
    await module.setTrust(hash, rootPath, HOOKS_ONLY);

    const freshModule = new AIFetchlyWorkspaceTrustModule();
    const trust = await freshModule.getTrust(hash);
    expect(trust).to.deep.equal(HOOKS_ONLY);
  });

  describe("ensureMigrationSeed (D-Migration)", () => {
    it("seeds all-true for approved workspaces and is idempotent", async () => {
      const wsModule = new WorkspaceModule();
      const rootPath = uniquePath("migration-approved");
      const conversationId = uniqueConversationId("approved");
      const created = await wsModule.setWorkspace({
        conversationId,
        rootPath,
      });
      await wsModule.approveWorkspace(created.id);

      await module.ensureMigrationSeed();
      const hash = computeWorkspaceRootHash(rootPath);
      const trust = await module.getTrust(hash);
      expect(trust, "approved workspace should be seeded all-true").to.deep.equal(
        ALL_TRUE
      );

      // Second run changes nothing (idempotent).
      await module.ensureMigrationSeed();
      const rowsForHash = (await model.listAll()).filter(
        (e) => e.workspaceRootHash === hash
      );
      expect(rowsForHash.length).to.equal(1);
    });

    it("does NOT seed workspaces that are still pending (source filter)", async () => {
      const wsModule = new WorkspaceModule();
      const rootPath = uniquePath("migration-pending");
      const conversationId = uniqueConversationId("pending");
      await wsModule.setWorkspace({ conversationId, rootPath });
      // left in 'pending' state on purpose

      await module.ensureMigrationSeed();
      const hash = computeWorkspaceRootHash(rootPath);
      const trust = await module.getTrust(hash);
      expect(trust, "pending workspace must not be seeded").to.be.null;
    });
  });
});
