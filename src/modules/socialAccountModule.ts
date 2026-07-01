import { SocialAccountModel } from "@/model/SocialAccount.model";
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
import { ProxyModule } from "./ProxyModule";
import { SocialPlatformList } from "@/config/generate";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";

export class SocialAccountModule extends BaseModule {
  private socialAccountModel: SocialAccountModel;
  private accountCookiesModule: AccountCookiesModule;

  constructor() {
    super();
    this.socialAccountModel = new SocialAccountModel(this.dbpath);
    this.accountCookiesModule = new AccountCookiesModule();
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
        console.warn(
          "[SocialAccountModule] decryptPass: secret key unavailable",
          error.message
        );
      } else {
        console.error(
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
          const cookies = await this.accountCookiesModule.getAccountCookies(
            account.id
          );
          const hasCookies = !!(
            cookies &&
            cookies.cookies &&
            JSON.parse(cookies.cookies).length > 0
          );

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
        // Also delete associated cookies
        await this.accountCookiesModule.deleteCookies(id);

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
}
