"use strict";
import { SocialAccountModule } from "@/modules/socialAccountModule";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import expect from "expect.js";

// We test the module by stubbing the private Model and the secret-key service.
// The module's crypto helpers depend on userSecretKeyService.getKey() —
// we replace that with an in-memory stub so no HttpClient is touched.

const TEST_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex"
);

function makeEntity(
  overrides: Partial<SocialAccountEntity> = {}
): SocialAccountEntity {
  const e = new SocialAccountEntity();
  e.id = 1;
  e.social_type_id = 1;
  e.user = "alice";
  e.pass = null;
  e.status = 1;
  e.name = "Alice";
  e.phone = "";
  e.email = "";
  e.proxy = [];
  Object.assign(e, overrides);
  return e;
}

describe("SocialAccountModule crypto wiring", function () {
  let originalGetKey: typeof userSecretKeyService.getKey;

  beforeEach(function () {
    originalGetKey = userSecretKeyService.getKey.bind(userSecretKeyService);
  });

  afterEach(function () {
    // Restore original implementation.
    (
      userSecretKeyService as unknown as {
        getKey: typeof userSecretKeyService.getKey;
      }
    ).getKey = originalGetKey;
    userSecretKeyService.invalidate();
  });

  function stubKeySuccess() {
    (
      userSecretKeyService as unknown as { getKey: () => Promise<Buffer> }
    ).getKey = async () => TEST_KEY;
  }

  function stubKeyFailure() {
    (
      userSecretKeyService as unknown as { getKey: () => Promise<Buffer> }
    ).getKey = async () => {
      throw new SecretKeyUnavailableError("stubbed unavailable");
    };
  }

  describe("saveSocialAccount", function () {
    it("encrypts the pass field before handing the entity to the Model", async function () {
      stubKeySuccess();

      let captured: SocialAccountEntity | null = null;
      const mod = new SocialAccountModule();
      // Replace the Model with an in-test double that records what it gets.
      (
        mod as unknown as {
          socialAccountModel: {
            saveSocialAccount: (e: SocialAccountEntity) => Promise<number>;
          };
        }
      ).socialAccountModel = {
        async saveSocialAccount(e: SocialAccountEntity) {
          captured = e;
          return 42;
        },
      };

      const result = await mod.saveSocialAccount({
        user: "alice",
        pass: "my-password",
        status: 1,
        name: "Alice",
        phone: "",
        email: "",
        proxy: [],
      });

      expect(result.status).to.be(true);
      expect(captured).not.to.be(null);
      expect(
        FieldCipher.isEncrypted((captured as SocialAccountEntity).pass)
      ).to.be(true);
      expect((captured as SocialAccountEntity).pass).not.to.equal(
        "my-password"
      );
    });

    it("does not encrypt and leaves pass unset when pass is null", async function () {
      stubKeySuccess();

      let captured: SocialAccountEntity | null = null;
      const mod = new SocialAccountModule();
      (
        mod as unknown as {
          socialAccountModel: {
            saveSocialAccount: (e: SocialAccountEntity) => Promise<number>;
          };
        }
      ).socialAccountModel = {
        async saveSocialAccount(e: SocialAccountEntity) {
          captured = e;
          return 1;
        },
      };

      await mod.saveSocialAccount({
        user: "alice",
        pass: null,
        status: 1,
        name: "Alice",
        phone: "",
        email: "",
        proxy: [],
      });

      // Wiring skips the assignment entirely when pass is null/undefined,
      // so the entity keeps its default (undefined) and is NOT encrypted.
      expect(
        FieldCipher.isEncrypted((captured as SocialAccountEntity).pass)
      ).to.be(false);
    });

    it("returns account.encryption_unavailable msg when key fetch fails, and does NOT call the Model", async function () {
      stubKeyFailure();

      let modelCalled = false;
      const mod = new SocialAccountModule();
      (
        mod as unknown as {
          socialAccountModel: {
            saveSocialAccount: (e: SocialAccountEntity) => Promise<number>;
          };
        }
      ).socialAccountModel = {
        async saveSocialAccount() {
          modelCalled = true;
          return 1;
        },
      };

      const result = await mod.saveSocialAccount({
        user: "alice",
        pass: "my-password",
        status: 1,
        name: "Alice",
        phone: "",
        email: "",
        proxy: [],
      });

      expect(result.status).to.be(false);
      expect(result.msg).to.equal("account.encryption_unavailable");
      expect(modelCalled).to.be(false);
    });
  });

  describe("getSocialAccountList", function () {
    it("decrypts encrypted pass rows to plaintext", async function () {
      stubKeySuccess();

      const encryptedPass = FieldCipher.encrypt("plain", TEST_KEY);
      const mod = new SocialAccountModule();
      (
        mod as unknown as {
          socialAccountModel: {
            getSocialAccountList: () => Promise<{
              records: SocialAccountEntity[];
              total: number;
            }>;
          };
          accountCookiesModule: { getAccountCookies: () => Promise<null> };
        }
      ).socialAccountModel = {
        async getSocialAccountList() {
          return { records: [makeEntity({ pass: encryptedPass })], total: 1 };
        },
      };
      (
        mod as unknown as {
          accountCookiesModule: { getAccountCookies: () => Promise<null> };
        }
      ).accountCookiesModule = {
        async getAccountCookies() {
          return null;
        },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect(result.status).to.equal("success");
      const record = (result.data.records || [])[0];
      expect(record.pass).to.equal("plain");
    });

    it("returns legacy plaintext as-is (lazy migration)", async function () {
      stubKeySuccess();

      const mod = new SocialAccountModule();
      (
        mod as unknown as {
          socialAccountModel: {
            getSocialAccountList: () => Promise<{
              records: SocialAccountEntity[];
              total: number;
            }>;
          };
        }
      ).socialAccountModel = {
        async getSocialAccountList() {
          return {
            records: [makeEntity({ pass: "legacy-plaintext-pw" })],
            total: 1,
          };
        },
      };
      (
        mod as unknown as {
          accountCookiesModule: { getAccountCookies: () => Promise<null> };
        }
      ).accountCookiesModule = {
        async getAccountCookies() {
          return null;
        },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      const record = (result.data.records || [])[0];
      expect(record.pass).to.equal("legacy-plaintext-pw");
    });

    it("returns null pass for a corrupt row without throwing, and other rows still decrypt", async function () {
      stubKeySuccess();

      const goodPass = FieldCipher.encrypt("plain", TEST_KEY);
      // Corrupt row: has the ENC1: prefix but a malformed payload.
      const corruptPass = "ENC1:aaaa:bbbb";

      const mod = new SocialAccountModule();
      (
        mod as unknown as {
          socialAccountModel: {
            getSocialAccountList: () => Promise<{
              records: SocialAccountEntity[];
              total: number;
            }>;
          };
        }
      ).socialAccountModel = {
        async getSocialAccountList() {
          return {
            records: [
              makeEntity({ id: 1, pass: goodPass }),
              makeEntity({ id: 2, pass: corruptPass }),
            ],
            total: 2,
          };
        },
      };
      (
        mod as unknown as {
          accountCookiesModule: { getAccountCookies: () => Promise<null> };
        }
      ).accountCookiesModule = {
        async getAccountCookies() {
          return null;
        },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect(result.status).to.equal("success");
      const records = result.data.records || [];
      expect(records[0].pass).to.equal("plain");
      expect(records[1].pass).to.be(null);
    });

    it("returns null pass for every row when key is unavailable, and still renders the list", async function () {
      stubKeyFailure();

      const mod = new SocialAccountModule();
      (
        mod as unknown as {
          socialAccountModel: {
            getSocialAccountList: () => Promise<{
              records: SocialAccountEntity[];
              total: number;
            }>;
          };
        }
      ).socialAccountModel = {
        async getSocialAccountList() {
          return {
            records: [
              makeEntity({ pass: FieldCipher.encrypt("plain", TEST_KEY) }),
            ],
            total: 1,
          };
        },
      };
      (
        mod as unknown as {
          accountCookiesModule: { getAccountCookies: () => Promise<null> };
        }
      ).accountCookiesModule = {
        async getAccountCookies() {
          return null;
        },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect(result.status).to.equal("success");
      expect((result.data.records || [])[0].pass).to.be(null);
    });

    it("passes null pass through unchanged", async function () {
      stubKeySuccess();

      const mod = new SocialAccountModule();
      (
        mod as unknown as {
          socialAccountModel: {
            getSocialAccountList: () => Promise<{
              records: SocialAccountEntity[];
              total: number;
            }>;
          };
        }
      ).socialAccountModel = {
        async getSocialAccountList() {
          return { records: [makeEntity({ pass: null })], total: 1 };
        },
      };
      (
        mod as unknown as {
          accountCookiesModule: { getAccountCookies: () => Promise<null> };
        }
      ).accountCookiesModule = {
        async getAccountCookies() {
          return null;
        },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect((result.data.records || [])[0].pass).to.be(null);
    });
  });

  describe("entity-array read methods (decryptPasses chokepoint)", function () {
    /**
     * Builds a SocialAccountModule whose Model returns one encrypted row
     * and one legacy plaintext row, for any of the three array-returning methods.
     */
    function makeModuleWithArrayStub(
      methodName:
        | "getAllSocialAccounts"
        | "getSocialAccountsByStatus"
        | "getSocialAccountsByPlatform"
    ): SocialAccountModule {
      stubKeySuccess();
      const encryptedPass = FieldCipher.encrypt("plain", TEST_KEY);
      const mod = new SocialAccountModule();
      const fakeModel = {
        async [methodName]() {
          return [
            makeEntity({ id: 1, pass: encryptedPass }),
            makeEntity({ id: 2, pass: "legacy" }),
          ];
        },
      };
      (mod as unknown as { socialAccountModel: unknown }).socialAccountModel =
        fakeModel;
      return mod;
    }

    it("getAllSocialAccounts decrypts encrypted rows and returns legacy rows as-is", async function () {
      const mod = makeModuleWithArrayStub("getAllSocialAccounts");
      const out = await mod.getAllSocialAccounts();
      expect(out[0].pass).to.equal("plain");
      expect(out[1].pass).to.equal("legacy");
    });

    it("getSocialAccountsByStatus decrypts encrypted rows via decryptPasses", async function () {
      const mod = makeModuleWithArrayStub("getSocialAccountsByStatus");
      const out = await mod.getSocialAccountsByStatus(1);
      expect(out[0].pass).to.equal("plain");
      expect(out[1].pass).to.equal("legacy");
    });

    it("getSocialAccountsByPlatform decrypts encrypted rows via decryptPasses", async function () {
      const mod = makeModuleWithArrayStub("getSocialAccountsByPlatform");
      const out = await mod.getSocialAccountsByPlatform(1);
      expect(out[0].pass).to.equal("plain");
      expect(out[1].pass).to.equal("legacy");
    });
  });
});
