import { Repository } from 'typeorm';
import { ContactInfoEntity } from '../entity/ContactInfo.entity';
import { SqliteDb } from '../config/SqliteDb';
import path from 'path';

/**
 * Repository for ContactInfo entity
 * Provides custom query methods for contact information management
 */
export class ContactInfoRepository {

    /**
     * Get the TypeORM repository
     */
    private getRepository(): Repository<ContactInfoEntity> {
        const db = SqliteDb.getInstance(path.join((process as any).app?.getPath('userData') || '', 'scraper.db'));
        return db.connection.getRepository(ContactInfoEntity);
    }

    /**
     * Find contact info by result ID
     */
    async findByResultId(resultId: number): Promise<ContactInfoEntity | null> {
        const repository = this.getRepository();
        return repository.findOne({ where: { resultId } as any });
    }

    /**
     * Find multiple contact info by result IDs
     */
    async findByResultIds(resultIds: number[]): Promise<ContactInfoEntity[]> {
        const repository = this.getRepository();
        return repository.createQueryBuilder('contactInfo')
            .where('contactInfo.resultId IN (:...resultIds)', { resultIds })
            .getMany();
    }

    /**
     * Update extraction status
     */
    async updateStatus(
        resultId: number,
        status: 'pending' | 'analyzing' | 'completed' | 'failed',
        error?: string
    ): Promise<void> {
        const repository = this.getRepository();
        await repository.update(
            { resultId } as any,
            {
                extractionStatus: status,
                extractionError: error || null,
                ...(status === 'completed' && { extractionDate: new Date() })
            }
        );
    }

    /**
     * Find by extraction status
     */
    async findByStatus(status: string): Promise<ContactInfoEntity[]> {
        const repository = this.getRepository();
        return repository.find({ where: { extractionStatus: status } as any });
    }

    /**
     * Find pending extractions (for queue processing)
     */
    async findPendingExtractions(limit = 10): Promise<ContactInfoEntity[]> {
        const repository = this.getRepository();
        return repository.find({
            where: { extractionStatus: 'pending' } as any,
            take: limit,
            order: { id: 'ASC' } as any
        });
    }

    /**
     * Find failed extractions (for retry)
     */
    async findFailedExtractions(limit = 10): Promise<ContactInfoEntity[]> {
        const repository = this.getRepository();
        return repository.find({
            where: { extractionStatus: 'failed' } as any,
            take: limit,
            order: { id: 'ASC' } as any
        });
    }

    /**
     * Save or update contact info (upsert)
     */
    async saveOrUpdate(resultId: number, data: Partial<ContactInfoEntity>): Promise<ContactInfoEntity> {
        const repository = this.getRepository();
        const existing = await this.findByResultId(resultId);

        if (existing) {
            await repository.update({ resultId } as any, data);
            return this.findByResultId(resultId) as Promise<ContactInfoEntity>;
        } else {
            const newContactInfo = repository.create({ resultId, ...data });
            return repository.save(newContactInfo);
        }
    }

    /**
     * Delete contact info by result ID
     */
    async deleteByResultId(resultId: number): Promise<void> {
        const repository = this.getRepository();
        await repository.delete({ resultId } as any);
    }

    /**
     * Get extraction statistics
     */
    async getStatistics(): Promise<{
        total: number;
        completed: number;
        failed: number;
        pending: number;
        analyzing: number;
    }> {
        const repository = this.getRepository();

        const [
            total,
            completed,
            failed,
            pending,
            analyzing
        ] = await Promise.all([
            repository.count(),
            repository.count({ where: { extractionStatus: 'completed' } as any }),
            repository.count({ where: { extractionStatus: 'failed' } as any }),
            repository.count({ where: { extractionStatus: 'pending' } as any }),
            repository.count({ where: { extractionStatus: 'analyzing' } as any })
        ]);

        return { total, completed, failed, pending, analyzing };
    }
}

// Export singleton instance
export const contactInfoRepository = new ContactInfoRepository();
