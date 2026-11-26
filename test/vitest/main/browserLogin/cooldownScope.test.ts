import { describe, expect, it, vi } from "vitest";
import { SocialAccountModule } from "@/modules/socialAccountModule";

// P03: the verifier is KEYED by the account encryption key - the test
// pins a fixed key so both the marker and the comparison derive the same
// value (the real service fetches from a backend that is absent here).
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

/**
 * A-FR-10: the 15-minute sign-in cooldown is per account AND SITE, and a
 * failure that must never start a cooldown (form_not_found, the challenge
 * handoff) is skipped by the credential service.
 */

describe("sign-in cooldown scope (A-FR-10)", () => {
  it("a REJECTED SAVED credential blocks account-wide until the stored value CHANGES (R08 digest binding)", async () => {
    const module = new SocialAccountModule();
    (
      module as unknown as {
        ensureConnection: () => Promise<void>;
      }
    ).ensureConnection = async () => undefined;
    const rejectedValue = "rejected-secret-v1";
    // P03: the marker uses the SAME keyed verifier as the comparison.
    const rejectedDigest =
      await SocialAccountModule.credentialVerifierDigest(rejectedValue);
    const now = new Date("2026-11-14T12:00:00Z");
    const makeFixture = (
      storedPass: string | null
    ): {
      last_login_failure_at: Date;
      last_login_failure_site: number | null;
      last_login_failure_reason: string;
      pass: string | null;
    } => ({
      last_login_failure_at: new Date("2026-11-01T00:00:00Z"),
      last_login_failure_site: null,
      last_login_failure_reason: `${SocialAccountModule.WRONG_CREDENTIAL_SAVED_REASON}:${rejectedDigest}`,
      pass: storedPass,
    });
    let fixture = makeFixture(rejectedValue);
    (
      module as unknown as {
        socialAccountModel: { findRowById: (id: number) => Promise<unknown> };
      }
    ).socialAccountModel.findRowById = async () => fixture;
    // The stored credential IS the rejected value — blocked account-wide
    // no matter how long ago the rejection landed.
    expect(
      await module.isSignInCoolingDown(7, { siteId: 42, now })
    ).toBe(true);
    expect(
      await module.isSignInCoolingDown(7, { siteId: 43, now })
    ).toBe(true);
    // The credential was REPLACED — the digest no longer matches and the
    // block lifts automatically (a late rejection of the prior value
    // cannot mark the newer credential).
    fixture = makeFixture("new-secret-v2");
    expect(
      await module.isSignInCoolingDown(7, { siteId: 42, now })
    ).toBe(false);
    // A regular (non-marker) failure older than the window is NOT blocked.
    fixture = {
      last_login_failure_at: new Date("2026-11-01T00:00:00Z"),
      last_login_failure_site: 42,
      last_login_failure_reason: "form_not_submitted",
      pass: rejectedValue,
    };
    expect(
      await module.isSignInCoolingDown(7, { siteId: 42, now })
    ).toBe(false);
  });

  it("credentialReplaced lifts only the wrong-credential block (R08)", async () => {
    const module = new SocialAccountModule();
    (
      module as unknown as {
        ensureConnection: () => Promise<void>;
      }
    ).ensureConnection = async () => undefined;
    let stored = {
      last_login_failure_at: new Date("2026-11-01T00:00:00Z") as Date | null,
      last_login_failure_site: 42 as number | null,
      last_login_failure_reason:
        SocialAccountModule.WRONG_CREDENTIAL_SAVED_REASON as string | null,
    };
    let cleared = 0;
    (
      module as unknown as {
        socialAccountModel: {
          findRowById: (id: number) => Promise<unknown>;
          updateLoginFailure: (
            id: number,
            fields: Record<string, unknown>
          ) => Promise<void>;
        };
      }
    ).socialAccountModel = {
      findRowById: async () => stored,
      updateLoginFailure: async (_id, fields) => {
        cleared++;
        stored = {
          ...stored,
          last_login_failure_at:
            (fields.last_login_failure_at as Date | null) ?? null,
          last_login_failure_reason:
            (fields.last_login_failure_reason as string | null) ?? null,
        };
      },
    };
    await module.credentialReplaced(7);
    expect(cleared).toBe(1);
    // The block lifted: the failure record is cleared.
    expect(
      await module.isSignInCoolingDown(7, {
        siteId: 42,
        now: new Date("2026-11-14T12:00:00Z"),
      })
    ).toBe(false);
    // A NON-marker failure is NOT lifted by a replacement.
    stored = {
      last_login_failure_at: new Date("2026-11-01T00:00:00Z"),
      last_login_failure_site: 42,
      last_login_failure_reason: "form_not_submitted",
    };
    await module.credentialReplaced(7);
    expect(cleared).toBe(1);
  });

  it("same account, different site: no cooldown", async () => {
    const module = new SocialAccountModule();
    const fixed = new Date("2026-11-14T12:00:00Z");
    // G06: fully isolate the fixture — stub ensureConnection (no TypeORM
    // schema init; parallel workers no longer race the shared SQLite file)
    // and the row lookup through the model seam the module reads.
    (
      module as unknown as {
        ensureConnection: () => Promise<void>;
      }
    ).ensureConnection = async () => undefined;
    (
      module as unknown as {
        socialAccountModel: { findRowById: (id: number) => Promise<unknown> };
      }
    ).socialAccountModel.findRowById = async () => ({
      last_login_failure_at: fixed,
      last_login_failure_site: 42,
    });
    // A failure recorded on site 42:
    const cooling = await module.isSignInCoolingDown(7, {
      siteId: 42,
      now: new Date(fixed.getTime() + 60_000),
    });
    expect(cooling).toBe(true);
    // …never cools down site 43.
    const otherSite = await module.isSignInCoolingDown(7, {
      siteId: 43,
      now: new Date(fixed.getTime() + 60_000),
    });
    expect(otherSite).toBe(false);
    // A failure with NO site cools every site (legacy rows).
    (
      module as unknown as {
        socialAccountModel: { findRowById: (id: number) => Promise<unknown> };
      }
    ).socialAccountModel.findRowById = async () => ({
      last_login_failure_at: fixed,
      last_login_failure_site: null,
    });
    const legacy = await module.isSignInCoolingDown(7, {
      siteId: 43,
      now: new Date(fixed.getTime() + 60_000),
    });
    expect(legacy).toBe(true);
    // Outside the window: not cooling.
    const expired = await module.isSignInCoolingDown(7, {
      siteId: 43,
      now: new Date(fixed.getTime() + 16 * 60_000),
    });
    expect(expired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P03/A-FR-10: legacy BARE markers (recorded before the digest scheme)
// keep the cooldown conservatively until a replacement lifts them, and
// the keyed verifier replaces the unkeyed truncated password hash.
// ---------------------------------------------------------------------------
describe("legacy marker compatibility (P03)", () => {
  it("a legacy BARE marker keeps the cooldown (conservative until replaced)", async () => {
    const module = new SocialAccountModule();
    (
      module as unknown as { ensureConnection: () => Promise<void> }
    ).ensureConnection = async () => undefined;
    (
      module as unknown as {
        socialAccountModel: {
          findRowById: (id: number) => Promise<unknown>;
        };
      }
    ).socialAccountModel = {
      findRowById: async () => ({
        last_login_failure_at: new Date("2026-11-01T00:00:00Z"),
        last_login_failure_site: null,
        // The LEGACY bare marker (no digest suffix).
        last_login_failure_reason:
          SocialAccountModule.WRONG_CREDENTIAL_SAVED_REASON,
        pass: "any-stored-value",
      }),
    };
    // The rejected value is unknown — the cooldown applies regardless of
    // the current stored credential (the safe direction).
    await expect(module.isSignInCoolingDown(1)).resolves.toBe(true);
    // A replacement clears the bare marker.
    (
      module as unknown as {
        socialAccountModel: {
          findRowById: (id: number) => Promise<unknown>;
          updateLoginFailure: (
            id: number,
            reason: string,
            siteId: number | null
          ) => Promise<void>;
        };
      }
    ).socialAccountModel.updateLoginFailure = async () => undefined;
    const clearSpy = vi.fn();
    (
      module as unknown as {
        recordLoginFailureClear: (id: number) => Promise<void>;
      }
    ).recordLoginFailureClear = clearSpy;
    (
      module as unknown as {
        socialAccountModel: {
          findRowById: (id: number) => Promise<{ last_login_failure_reason: string } | null>;
        };
      }
    ).socialAccountModel.findRowById = async () => ({
      last_login_failure_reason: SocialAccountModule.WRONG_CREDENTIAL_SAVED_REASON,
    });
    await module.credentialReplaced(1);
    expect(clearSpy).toHaveBeenCalledWith(1);
  });

  it("the keyed verifier differs from the bare unkeyed hash and is stable", async () => {
    const digest = await SocialAccountModule.credentialVerifierDigest("pw");
    // 32 hex chars (128 bits of keyed verifier) — not the old 16-char
    // bare hash.
    expect(digest).toHaveLength(32);
    const digest2 = await SocialAccountModule.credentialVerifierDigest("pw");
    expect(digest2).toBe(digest);
    const other = await SocialAccountModule.credentialVerifierDigest("pw2");
    expect(other).not.toBe(digest);
  });
});
