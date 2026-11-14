import { SocialAccountModel } from "@/model/SocialAccount.model";
import { log } from "@/modules/Logger";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import { ProxyEntity } from "@/entity/Proxy.entity";
import { BaseModule } from "@/modules/baseModule";
import {
  SocialAccountResponse,
  SocialAccountDetailResponse,
  SocialAccountDetailData,
  SavesocialaccountResp,
} from "@/entityTypes/socialaccount-type";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { AccountSessionService } from "@/modules/AccountSessionService";
import { ProxyModule } from "./ProxyModule";
import { SocialPlatformList } from "@/config/generate";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";

export class SocialAccountModule extends BaseModule {
  private socialAccountModel: SocialAccountModel;
  private accountCookiesModule: AccountCookiesModule;
  private accountSessionService: AccountSessionService;

  constructor() {
    super();
    this.socialAccountModel = new SocialAccountModel(this.dbpath);
    this.accountCookiesModule = new AccountCookiesModule();
    this.accountSessionService = new AccountSessionService();
  }

  /**
   * Encrypts a plaintext password for storage. Null-safe.
   * @throws SecretKeyUnavailableError if the backend key cannot be obtained.
   */
  private async encryptPass(
    plaintext: string | null | undefined
  ): Promise<string | null> {
    if (plaintext == null || plaintext === "") {
      return plaintext ?? null;
    }
    const key = await userSecretKeyService.getKey();
    return FieldCipher.encrypt(plaintext, key);
  }

  /**
   * Decrypts a stored pass value. Null-safe and legacy-aware.
   *
   * - null/undefined -> null
   * - legacy plaintext (no ENC1: prefix) -> returned as-is (lazy migration)
   * - ENC1: envelope -> decrypted; on failure logs and returns null
   *
   * Fail-soft on SecretKeyUnavailableError: returns null so list views keep rendering.
   */
  private async decryptPass(
    stored: string | null | undefined,
    accountId?: number
  ): Promise<string | null> {
    if (stored == null) {
      return null;
    }
    if (!FieldCipher.isEncrypted(stored)) {
      // Legacy plaintext -- return as-is. Next save() will encrypt it.
      return stored;
    }
    try {
      const key = await userSecretKeyService.getKey();
      return FieldCipher.decrypt(stored, key);
    } catch (error) {
      if (error instanceof SecretKeyUnavailableError) {
        log.warn(
          "[SocialAccountModule] decryptPass: secret key unavailable",
          error.message
        );
      } else {
        log.error(
          "[SocialAccountModule] decryptPass: failed for account",
          accountId,
          error
        );
      }
      return null;
    }
  }

  /**
   * Applies decryptPass to every entity in an array. Returns NEW objects
   * (does not mutate the input). Used by the entity-array read methods.
   */
  private async decryptPasses(
    entities: SocialAccountEntity[]
  ): Promise<SocialAccountEntity[]> {
    return Promise.all(
      entities.map(async (e) => {
        const decrypted = new SocialAccountEntity();
        Object.assign(decrypted, e, {
          pass: await this.decryptPass(e.pass, e.id),
        });
        return decrypted;
      })
    );
  }

  /**
   * Get social account list with pagination and search
   */
  public async getSocialAccountList(
    page: number,
    size: number,
    search: string,
    platform?: number
  ): Promise<SocialAccountResponse> {
    try {
      const result = await this.socialAccountModel.getSocialAccountList(
        page,
        size,
        search,
        platform
      );

      // Add cookies information to each account
      const recordsWithCookies = await Promise.all(
        result.records.map(async (account) => {
          // Presence is derived from non-secret session metadata (cookie count),
          // never by parsing cookie values into the renderer payload.
          const meta = await this.accountSessionService.getMetadata(account.id);
          const hasCookies = meta.hasCookies && meta.cookieCount > 0;

          // Map social_type_id to platform name
          const platform = SocialPlatformList.find(
            (item) => item.id === account.social_type_id
          );
          const socialType = platform ? platform.name : "";

          return {
            id: account.id,
            social_type: socialType,
            social_type_id: account.social_type_id,
            user: account.user,
            pass: await this.decryptPass(account.pass, account.id),
            status: account.status,
            use_proxy: account.proxy && account.proxy.length > 0 ? 1 : 0,
            cookies: hasCookies,
          };
        })
      );

      return {
        status: "success",
        msg: "Social accounts retrieved successfully",
        data: {
          total: result.total,
          records: recordsWithCookies,
        },
      };
    } catch (error) {
      return {
        status: "error",
        msg: error instanceof Error ? error.message : "Unknown error occurred",
        data: {
          total: 0,
          records: [],
        },
      };
    }
  }

  /**
   * Get social account detail by ID
   */
  public async getAccountDetail(
    id: number
  ): Promise<SocialAccountDetailResponse> {
    try {
      const account = await this.socialAccountModel.getSocialAccountById(id);

      if (!account) {
        return {
          status: "error",
          msg: "Social account not found",
          data: null as any,
        };
      }

      // Convert to SocialAccountDetailData format
      const detailData: SocialAccountDetailData = {
        id: account.id,
        social_type_id: account.social_type_id,
        user: account.user,
        pass: await this.decryptPass(account.pass, account.id),
        status: account.status,
        name: account.name,
        phone: account.phone,
        email: account.email,
        proxy: account.proxy || [],
      };

      return {
        status: "success",
        msg: "Social account detail retrieved successfully",
        data: detailData,
      };
    } catch (error) {
      return {
        status: "error",
        msg: error instanceof Error ? error.message : "Unknown error occurred",
        data: null as any,
      };
    }
  }

  /**
   * Save social account
   */
  public async saveSocialAccount(
    socialAccountData: SocialAccountDetailData
  ): Promise<SavesocialaccountResp> {
    try {
      const socialAccount = new SocialAccountEntity();

      // Map the data
      if (socialAccountData.id) {
        socialAccount.id = socialAccountData.id;
      }
      // if (socialAccountData.social_type) {
      //     socialAccount.social_type = socialAccountData.social_type;
      // }
      if (socialAccountData.social_type_id) {
        socialAccount.social_type_id = socialAccountData.social_type_id;
      }
      // if (socialAccountData.social_type_url) {
      //     socialAccount.social_type_url = socialAccountData.social_type_url;
      // }
      socialAccount.user = socialAccountData.user;
      if (
        socialAccountData.pass !== undefined &&
        socialAccountData.pass !== null
      ) {
        socialAccount.pass = await this.encryptPass(socialAccountData.pass);
      }
      socialAccount.status = socialAccountData.status;
      socialAccount.name = socialAccountData.name;
      if (socialAccountData.phone) {
        socialAccount.phone = socialAccountData.phone;
      }
      if (socialAccountData.email) {
        socialAccount.email = socialAccountData.email;
      }
      if (socialAccountData.proxy) {
        // Convert Proxy[] to ProxyEntity[] by finding existing proxy entities
        const proxyEntities = await Promise.all(
          socialAccountData.proxy.map(async (proxy) => {
            if (proxy.id) {
              // Find existing proxy entity by ID
              // const existingProxy = await this.sqliteDb.connection
              //     .getRepository(ProxyEntity)
              //     .findOne({ where: { id: proxy.id } });
              // return existingProxy;
              const proxyModule = new ProxyModule();
              const proxyDetail = await proxyModule.getProxyDetail(proxy.id);
              return proxyDetail.data;
            }
            return null;
          })
        );
        socialAccount.proxy = proxyEntities.filter(
          (p) => p !== null
        ) as ProxyEntity[];
      }

      const savedId = await this.socialAccountModel.saveSocialAccount(
        socialAccount
      );

      return {
        status: true,
        msg: "Social account saved successfully",
        data: { id: savedId },
      };
    } catch (error) {
      if (error instanceof SecretKeyUnavailableError) {
        return {
          status: false,
          msg: "account.encryption_unavailable",
          data: { id: 0 },
        };
      }
      return {
        status: false,
        msg: error instanceof Error ? error.message : "Unknown error occurred",
        data: { id: 0 },
      };
    }
  }

  /**
   * Delete social account
   */
  public async deleteAccount(
    id: number
  ): Promise<{ status: boolean; msg: string }> {
    try {
      const affectedRows = await this.socialAccountModel.deleteSocialAccount(
        id
      );

      if (affectedRows > 0) {
        // Also delete the encrypted cookie snapshot and clear the account's
        // Electron partition storage (scoped to this account only).
        await this.accountSessionService.clearAccountSession(id);

        return {
          status: true,
          msg: "Social account deleted successfully",
        };
      } else {
        return {
          status: false,
          msg: "Social account not found",
        };
      }
    } catch (error) {
      return {
        status: false,
        msg: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  /**
   * Get all social accounts
   */
  public async getAllSocialAccounts(): Promise<SocialAccountEntity[]> {
    return this.decryptPasses(
      await this.socialAccountModel.getAllSocialAccounts()
    );
  }

  /**
   * N05/P-FR-03: after a successful sign-in THROUGH a proxy, link that
   * proxy row to the account so later sessions reuse it. Idempotent —
   * an existing link is left untouched.
   */
  public async linkProxyToAccount(
    accountId: number,
    proxyId: number
  ): Promise<boolean> {
    try {
      const account = await this.socialAccountModel.getSocialAccountById(accountId);
      if (!account) {
        return false;
      }
      const existing = (account.proxy ?? []).some((row) => row.id === proxyId);
      if (existing) {
        return true;
      }
      const { ProxyModel } = await import("@/model/Proxy.model");
      const { Token } = await import("@/modules/token");
      const { USERSDBPATH } = await import("@/config/usersetting");
      const proxyModel = new ProxyModel(
        new Token().getValue(USERSDBPATH)
      );
      const proxyEntity = await proxyModel.getProxyById(proxyId);
      if (!proxyEntity) {
        return false;
      }
      await this.socialAccountModel.appendProxyLink(accountId, proxyId);
      return true;
    } catch (error) {
      log.warn(
        `[SocialAccountModule] proxy link failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Get social accounts by status
   */
  public async getSocialAccountsByStatus(
    status: number
  ): Promise<SocialAccountEntity[]> {
    return this.decryptPasses(
      await this.socialAccountModel.getSocialAccountsByStatus(status)
    );
  }

  /**
   * Get social accounts by platform
   */
  public async getSocialAccountsByPlatform(
    socialTypeId: number
  ): Promise<SocialAccountEntity[]> {
    return this.decryptPasses(
      await this.socialAccountModel.getSocialAccountsByPlatform(socialTypeId)
    );
  }

  /**
   * A-FR-03/13: accounts usable for AI sign-in on a site. Matches by
   * site_id first; falls back to the legacy social_type_id mapping (the
   * seeded BrowserSite rows keep the platform IDs). Respects the per-account
   * AI-use opt-in (Q-01) when `requireAiOptIn` is set.
   */
  public async getAccountsForSite(
    siteId: number,
    options?: { requireAiOptIn?: boolean; platformId?: number }
  ): Promise<Array<{ id: number; user: string; name: string; hasPassword: boolean }>> {
    await this.ensureConnection();
    // T27: repository access lives in the Model layer.
    const rows = await this.socialAccountModel.findRowsForSite(
      siteId,
      options?.platformId ?? siteId
    );
    const result: Array<{
      id: number;
      user: string;
      name: string;
      hasPassword: boolean;
    }> = [];
    for (const row of rows) {
      if (options?.requireAiOptIn && !row.ai_use_enabled) {
        continue;
      }
      result.push({
        id: row.id,
        user: row.user,
        name: row.name,
        hasPassword: Boolean(row.pass),
      });
    }
    return result;
  }

  /**
   * A-FR-07: the ONLY decrypting credential read used by sign-in. Returns
   * the username + decrypted password ONLY when the stored site identity
   * matches the CURRENT page's registrable domain — the caller derives that
   * identity from the live page URL, never from the LLM.
   */
  /**
   * F12: the credential read reports WHY it refused — a missing account, a
   * missing site, a domain mismatch and a missing/undecryptable password
   * are distinct outcomes; only the last one legitimately asks the user
   * for a password through the card.
   */
  public async getCredentialForLogin(
    accountId: number,
    /** X1: the LIVE page hostname — suffix checks are hostname-exact,
     * so host-specific allowlists (accounts.google.com) can match. */
    currentHostname: string
  ): Promise<
    | { ok: true; username: string; password: string }
    | {
        ok: false;
        reason:
          | "account_not_found"
          | "site_not_found"
          | "domain_mismatch"
          | "credential_unavailable";
      }
  > {
    await this.ensureConnection();
    // T27: repository access lives in the Model layer.
    const account = await this.socialAccountModel.findRowById(accountId);
    if (!account) {
      return { ok: false, reason: "account_not_found" };
    }
    // The account's site must match the page domain (fail closed).
    // R21: legacy rows with site_id = null CANNOT skip the domain check —
    // they are resolved via social_type_id (which maps to a seeded site).
    let siteToCheck = account.site_id;
    if (siteToCheck === null) {
      siteToCheck = account.social_type_id;
    }
    const siteModule = (await import("@/modules/BrowserSiteModule"))
      .getDefaultBrowserSiteModule();
    const site = await siteModule.getSite(siteToCheck);
    if (!site) {
      return { ok: false, reason: "site_not_found" };
    }
    const { hostnameAllowedBySuffixes } =
      await import("@/service/browserDecision/RegistrableDomain");
    if (
      !hostnameAllowedBySuffixes(
        currentHostname,
        site.allowedDomainSuffixes
      )
    ) {
      return { ok: false, reason: "domain_mismatch" };
    }
    const password = await this.decryptPass(account.pass, account.id);
    if (!password || !account.user) {
      return { ok: false, reason: "credential_unavailable" };
    }
    return { ok: true, username: account.user, password };
  }

  /** R21/A-FR-06: update the password of an existing account (encrypted). */
  public async updatePasswordForAccount(
    accountId: number,
    password: string
  ): Promise<void> {
    // F12: delegate to the Model layer (no direct repository access).
    await this.ensureConnection();
    const encrypted = await this.encryptPass(password);
    if (encrypted) {
      await this.socialAccountModel.updatePassword(accountId, encrypted);
    }
  }

  /** A-FR-10: record a failed automated sign-in (cooldown + UI reason). */
  public async recordLoginFailure(
    accountId: number,
    reason: string,
    now?: Date
  ): Promise<void> {
    await this.ensureConnection();
    await this.socialAccountModel.updateLoginFailure(accountId, {
      last_login_failure_at: now ?? new Date(),
      last_login_failure_reason: reason.slice(0, 64),
    });
  }

  /** A-FR-10: clear a prior failure after a successful sign-in. */
  public async recordLoginFailureClear(accountId: number): Promise<void> {
    await this.ensureConnection();
    await this.socialAccountModel.updateLoginFailure(accountId, {
      last_login_failure_at: null,
      last_login_failure_reason: null,
    });
  }

  /** A-FR-10: cooldown check (1 automated attempt per account+site/window). */
  public async isSignInCoolingDown(
    accountId: number,
    cooldownMs = 15 * 60_000,
    now?: Date
  ): Promise<boolean> {
    await this.ensureConnection();
    const account = await this.socialAccountModel.findRowById(accountId);
    if (!account?.last_login_failure_at) {
      return false;
    }
    const elapsed = (now ?? new Date()).getTime() - account.last_login_failure_at.getTime();
    return elapsed >= 0 && elapsed < cooldownMs;
  }

  /** Save a credential submitted through the secure card (A-FR-06). */
  public async saveSubmittedCredential(input: {
    readonly siteId: number | null;
    readonly platformId?: number;
    readonly username: string;
    readonly password: string;
    readonly save: boolean;
  }): Promise<number> {
    if (!input.save) {
      throw new Error("save_not_requested");
    }
    await this.ensureConnection();
    const entity = new SocialAccountEntity();
    entity.user = input.username;
    entity.name = input.username;
    entity.social_type_id = input.platformId ?? (input.siteId ?? 0);
    entity.site_id = input.siteId;
    entity.status = 1;
    // R21/A-FR-06: the user checked "Save for future use" — enable the
    // per-account AI-use opt-in so the credential is reusable.
    entity.ai_use_enabled = true;
    entity.pass = await this.encryptPass(input.password);
    return await this.socialAccountModel.saveNewAccount(entity);
  }
}