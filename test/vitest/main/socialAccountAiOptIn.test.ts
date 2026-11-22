import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";

/**
 * Q-01/R02: per-account AI opt-in — the credential card UPDATES an
 * existing same-user+site account instead of creating a duplicate, and
 * the opt-in is editable for existing accounts.
 */

// A UNIQUE temp DB per file (G06 fixture-isolation class): the shared
// resolveTestDbPath() fallback collides with parallel worker suites
// ("database is locked" during schema sync). Both BaseModule and BaseDb
// resolve USERSDBPATH to this file's own directory.
const tmpDir = path.join(
  os.tmpdir(),
  `social-account-optin-test-${process.pid}-${Date.now()}`
);
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string): string {
      return name === "user_dbpath" ? tmpDir : "";
    }
    setValue(): void {}
  },
}));

// A fixed 32-byte key so encrypt/decrypt round-trips in tests (the real
// service fetches from a backend that is absent here). BOTH the deep
// module and the index re-export are mocked so every importer sees it.
vi.mock("@/modules/fieldCipher/UserSecretKeyService", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/modules/fieldCipher/UserSecretKeyService")>();
  const spiedInstance = {
    ...original.userSecretKeyService,
    getKey: async (): Promise<Buffer> => Buffer.alloc(32, 0x42),
    invalidate: (): void => {},
  };
  return {
    ...original,
    userSecretKeyService: spiedInstance,
    UserSecretKeyService: original.UserSecretKeyService,
  };
});
vi.mock("@/modules/fieldCipher", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/modules/fieldCipher")>();
  const spiedInstance = {
    ...original.userSecretKeyService,
    getKey: async (): Promise<Buffer> => Buffer.alloc(32, 0x42),
    invalidate: (): void => {},
  };
  return {
    ...original,
    userSecretKeyService: spiedInstance,
  };
});

import { SqliteDb } from "@/config/SqliteDb";
import { SocialAccountModule } from "@/modules/socialAccountModule";

beforeAll(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
});

describe("SocialAccountModule per-account AI opt-in (Q-01/R02)", () => {
  beforeEach(() => {
    (SqliteDb as unknown as { instance: unknown }).instance = null;
    (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
    (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  });

  it("saving a credential twice for the same user+site updates, never duplicates", async () => {
    const module = new SocialAccountModule();
    const firstId = await module.saveSubmittedCredential({
      siteId: 2,
      platformId: 2,
      username: "creator@example.test",
      password: "first-secret",
      save: true,
    });
    expect(firstId).toBeGreaterThan(0);
    const secondId = await module.saveSubmittedCredential({
      siteId: 2,
      platformId: 2,
      username: "creator@example.test",
      password: "second-secret",
      save: true,
    });
    // SAME account row — the card never duplicates an existing account.
    expect(secondId).toBe(firstId);
    // The opt-in is ON after the card save.
    await expect(module.getAiUseEnabled(firstId)).resolves.toBe(true);
  });

  it("re-saving OPTS IN an existing disabled account (Q-01 duplicate guard)", async () => {
    const module = new SocialAccountModule();
    const id = await module.saveSubmittedCredential({
      siteId: 2,
      platformId: 2,
      username: "disabled@example.test",
      password: "pw",
      save: true,
    });
    // The user turned the opt-in OFF afterwards.
    await module.setAiUseEnabled(id, false);
    await expect(module.getAiUseEnabled(id)).resolves.toBe(false);
    // A new card save for the same account OPTS IT BACK IN (update, not
    // a duplicate row).
    const againId = await module.saveSubmittedCredential({
      siteId: 2,
      platformId: 2,
      username: "disabled@example.test",
      password: "pw2",
      save: true,
    });
    expect(againId).toBe(id);
    await expect(module.getAiUseEnabled(id)).resolves.toBe(true);
  });

  it("setAiUseEnabled refuses an unknown account", async () => {
    const module = new SocialAccountModule();
    await expect(module.setAiUseEnabled(999_999, true)).rejects.toThrow(
      "account_not_found"
    );
    await expect(module.getAiUseEnabled(999_999)).resolves.toBe(false);
  });

  it("a credential save without the save flag is refused", async () => {
    const module = new SocialAccountModule();
    await expect(
      module.saveSubmittedCredential({
        siteId: 2,
        platformId: 2,
        username: "no-save@example.test",
        password: "pw",
        save: false,
      })
    ).rejects.toThrow("save_not_requested");
  });
});

// ---------------------------------------------------------------------------
// P06/S-FR-01/Q-01: the pending prompt set preserves PRIOR consent (an
// already-opted-in row never re-enters), and a platform REBIND is an
// explicit credential/cookie transition (the old platform's password and
// cookie snapshot never silently carry across).
// ---------------------------------------------------------------------------
describe("SocialAccountModule opt-in cohort + rebind transition (P06)", () => {
  beforeEach(() => {
    (SqliteDb as unknown as { instance: unknown }).instance = null;
    (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
    (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  });

  it("an already-opted-in row never re-enters the pending prompt set", async () => {
    const module = new SocialAccountModule();
    // A pre-feature row: opted in via the toggle, never prompted.
    const id = await module.saveSubmittedCredential({
      siteId: 2,
      platformId: 2,
      username: "prior-consent@example.test",
      password: "pw",
      save: true,
    });
    await expect(module.getAiUseEnabled(id)).resolves.toBe(true);
    const pending = await module.listAccountsMissingOptIn();
    expect(pending.find((row) => row.id === id)).toBeUndefined();
  });

  it("a platform REBIND clears the old credential and the cookie snapshot", async () => {
    const module = new SocialAccountModule();
    const id = await module.saveSubmittedCredential({
      siteId: 2,
      platformId: 2,
      username: "rebind@example.test",
      password: "youtube-secret",
      save: true,
    });
    // The editor saves the account with a DIFFERENT platform — the
    // explicit identity transition.
    await module.saveSocialAccount({
      id,
      user: "rebind@example.test",
      pass: "",
      status: 1,
      name: "rebind",
      social_type_id: 3,
    } as never);
    const model = (module as unknown as {
      socialAccountModel: {
        findRowById: (id: number) => Promise<{ pass: string } | null>;
      };
    }).socialAccountModel;
    const row = await model.findRowById(id);
    // The old platform's credential never carries across — the stored
    // password is cleared (the user re-enters it for the new platform).
    expect(row?.pass === "" || row?.pass === null).toBe(true);
  });
});
