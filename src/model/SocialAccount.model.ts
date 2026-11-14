import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import { getRecorddatetime } from "@/modules/lib/function";

export class SocialAccountModel extends BaseDb {
    private repository: Repository<SocialAccountEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(SocialAccountEntity);
    }

    /** N05/P-FR-03: append the account↔proxy link (idempotent). */
    async appendProxyLink(accountId: number, proxyId: number): Promise<void> {
        const account = await this.repository.findOne({
            where: { id: accountId },
            relations: ["proxy"],
        });
        if (!account) {
            return;
        }
        const already = (account.proxy ?? []).some(
            (row: { id: number }) => row.id === proxyId
        );
        if (already) {
            return;
        }
        const { ProxyEntity } = await import("@/entity/Proxy.entity");
        const proxyRef = new ProxyEntity();
        proxyRef.id = proxyId;
        account.proxy = [...(account.proxy ?? []), proxyRef];
        await this.repository.save(account);
    }

    /**
     * Save social account
     */
    async saveSocialAccount(socialAccount: SocialAccountEntity): Promise<number> {
        if (!socialAccount.user) {
            throw new Error(`user field is required`);
        }

        if (socialAccount.id) {
            // Update existing account
            const existingAccount = await this.getSocialAccountById(socialAccount.id);
            if (existingAccount) {
                Object.assign(existingAccount, socialAccount);
                const savedAccount = await this.repository.save(existingAccount);
                return savedAccount.id;
            }
        }

        // Create new account
        const savedAccount = await this.repository.save(socialAccount);
        return savedAccount.id;
    }

    /**
     * Get social account by ID
     */
    async getSocialAccountById(id: number): Promise<SocialAccountEntity | null> {
        return this.repository.findOne({ 
            where: { id },
            relations: ['proxy']
        });
    }

    /**
     * Get social account list with pagination and search
     */
    async getSocialAccountList(
        page: number = 1,
        size: number = 10,
        search: string = "",
        platform?: number
    ): Promise<{ records: SocialAccountEntity[], total: number }> {
        const queryBuilder = this.repository.createQueryBuilder('account')
            .leftJoinAndSelect('account.proxy', 'proxy');

        if (search && search.length > 0) {
            queryBuilder.where(
                'account.user LIKE :search OR account.name LIKE :search OR account.email LIKE :search',
                { search: `%${search}%` }
            );
        }

        if (platform) {
            queryBuilder.andWhere('account.social_type_id = :platform', { platform });
        }

        const total = await queryBuilder.getCount();
        
        const records = await queryBuilder
            .skip((page - 1) * size)
            .take(size)
            .orderBy('account.createdAt', 'DESC')
            .getMany();

        return { records, total };
    }

    /**
     * Delete social account by ID
     */
    async deleteSocialAccount(id: number): Promise<number> {
        const result = await this.repository.delete({ id });
        return result.affected || 0;
    }

    /**
     * Get all social accounts
     */
    async getAllSocialAccounts(): Promise<SocialAccountEntity[]> {
        return this.repository.find({
            relations: ['proxy']
        });
    }

    /**
     * Get social accounts by status
     */
    async getSocialAccountsByStatus(status: number): Promise<SocialAccountEntity[]> {
        return this.repository.find({
            where: { status },
            relations: ['proxy']
        });
    }

    /**
     * Get social accounts by platform
     */
    async getSocialAccountsByPlatform(socialTypeId: number): Promise<SocialAccountEntity[]> {
        return this.repository.find({
            where: { social_type_id: socialTypeId },
            relations: ['proxy']
        });
    }

  /**
   * T27 (A-FR-03/13): raw rows for sign-in account matching — by site_id
   * first, falling back to the legacy social_type_id mapping. The MODULE
   * applies the AI opt-in filter and shapes the safe result.
   */
  async findRowsForSite(
    siteId: number,
    platformId: number
  ): Promise<SocialAccountEntity[]> {
    return await this.repository
      .createQueryBuilder("account")
      .where("account.site_id = :siteId", { siteId })
      .orWhere("account.social_type_id = :platformId", { platformId })
      .getMany();
  }

  /** T27 (A-FR-07): one raw account row by id (module decrypts). */
  async findRowById(accountId: number): Promise<SocialAccountEntity | null> {
    return await this.repository.findOne({ where: { id: accountId } });
  }

  /** T27 (A-FR-10): record/clear a failed automated sign-in. */
  async updateLoginFailure(
    accountId: number,
    fields: {
      last_login_failure_at: Date | null;
      last_login_failure_reason: string | null;
    }
  ): Promise<void> {
    await this.repository.update(accountId, fields);
  }

  /** T27 (A-FR-06): persist a card-submitted credential (module encrypts). */
  async saveNewAccount(entity: SocialAccountEntity): Promise<number> {
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  /** F12: update the password for an existing account (module encrypts). */
  async updatePassword(accountId: number, encryptedPass: string): Promise<void> {
    await this.repository.update(accountId, { pass: encryptedPass });
  }
}
