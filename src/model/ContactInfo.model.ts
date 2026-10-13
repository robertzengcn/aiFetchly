import { Repository } from 'typeorm';
import { ContactInfoEntity } from '../entity/ContactInfo.entity';
import { SqliteDb } from '../config/SqliteDb';
import { Token } from '../modules/token';
import { USERSDBPATH } from '../config/usersetting';

/**
 * Repository for ContactInfo entity
 * Provides custom query methods for contact information management
 *
 * IMPORTANT: This repository should ONLY be used in the main process.
 * Worker processes should send data to main process via IPC for database operations.
 */
export class ContactInfoRepository {

    /**
     * Get the TypeORM repository
     * Uses the same database path as the rest of the application
     *
     * @throws Error if used in worker process (DATABASE_PATH env var is set)
     */
    private async getRepository(): Promise<Repository<ContactInfoEntity>> {
        // Prevent direct database access from worker process
        if (process.env.DATABASE_PATH) {
            throw new Error(
                'Direct database access from worker process is not allowed. ' +
                'Worker should send data to main process via IPC for database operations.'
            );
        }

        const tokenService = new Token();
        const dbPath = tokenService.getValue(USERSDBPATH);

        if (!dbPath) {
            throw new Error('Database path not available');
        }

        const db = SqliteDb.getInstance(dbPath);

        // Ensure connection is initialized
        if (!db.connection.isInitialized) {
            await SqliteDb.ensureInitialized();
        }

        return db.connection.getRepository(ContactInfoEntity);
    }

    /**
     * Find contact info by result ID
     */
    async findByResultId(resultId: number): Promise<ContactInfoEntity | null> {
        const repository = await this.getRepository();
        return repository.findOne({ where: { resultId } as any });
    }

    /**
     * Find multiple contact info by result IDs
     */
    async findByResultIds(resultIds: number[]): Promise<ContactInfoEntity[]> {
        const repository = await this.getRepository();
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
        const repository = await this.getRepository();
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
        const repository = await this.getRepository();
        return repository.find({ where: { extractionStatus: status } as any });
    }

    /**
     * Find pending extractions (for queue processing)
     */
    async findPendingExtractions(limit = 10): Promise<ContactInfoEntity[]> {
        const repository = await this.getRepository();
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
        const repository = await this.getRepository();
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
        const repository = await this.getRepository();
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
        const repository = await this.getRepository();
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
        const repository = await this.getRepository();

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

    /**
     * Count contact rows created at/after a timestamp (execution-scoped freshness
     * bound, AC-03). `extraction_date` is the `@CreateDateColumn` (UTC text
     * `"YYYY-MM-DD HH:MM:SS"`, no offset marker); comparing against an ISO
     * string is lexicographically correct for the equal-format case.
     */
    async countSince(startedAt: Date): Promise<number> {
        const repository = await this.getRepository();
        return repository
            .createQueryBuilder('contact')
            .where('contact.extraction_date >= :startedAt', {
                startedAt: startedAt.toISOString(),
            })
            .getCount();
    }

    /**
     * Find the freshest contact row created at/after a timestamp, returning its
     * `extraction_date`. Used by the observation provider so `observedAt` is the
     * real row time, not `now()` — a historical row can no longer masquerade as
     * a fresh observation (AC-04/AC-03). Returns null when no in-window row
     * exists (fail-closed → unknown).
     */
    async findLatestSince(
        startedAt: Date
    ): Promise<{ extractionDate: Date } | null> {
        const repository = await this.getRepository();
        const row = await repository
            .createQueryBuilder('contact')
            .select('contact.extraction_date', 'extractionDate')
            .where('contact.extraction_date >= :startedAt', {
                startedAt: startedAt.toISOString(),
            })
            .orderBy('contact.extraction_date', 'DESC')
            .limit(1)
            .getRawOne<{ extractionDate: string } | undefined>();
        if (!row || !row.extractionDate) return null;
        return { extractionDate: new Date(row.extractionDate) };
    }
}

// Export singleton instance
export const contactInfoRepository = new ContactInfoRepository();
