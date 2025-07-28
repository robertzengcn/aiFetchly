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
} 