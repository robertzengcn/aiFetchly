import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    OneToOne,
    JoinColumn,
    CreateDateColumn,
    Index,
} from 'typeorm';
import { SearchResultEntity } from './SearchResult.entity';

@Entity('contact_info')
@Index(['resultId']) // For faster lookups
export class ContactInfoEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'result_id' })
    resultId: number; // Foreign key to SearchResult

    @OneToOne(() => SearchResultEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'result_id' })
    searchResult: SearchResultEntity;

    @Column({ name: 'email', nullable: true, type: 'text' })
    email: string | null;

    @Column({ name: 'phone', nullable: true, type: 'text' })
    phone: string | null;

    @Column({ name: 'address', nullable: true, type: 'text' })
    address: string | null;

    @Column({ name: 'social_links', nullable: true, type: 'json' })
    socialLinks: string[] | null; // Array of social media URLs

    @Column({
        name: 'extraction_status',
        type: 'enum',
        enum: ['pending', 'analyzing', 'completed', 'failed'],
        default: 'pending'
    })
    extractionStatus: string;

    @Column({ name: 'extraction_error', nullable: true, type: 'text' })
    extractionError: string | null;

    @CreateDateColumn({ name: 'extraction_date' })
    extractionDate: Date;

    @Column({ name: 'extraction_metadata', nullable: true, type: 'json' })
    extractionMetadata: {
        discoveredPageUrl?: string;
        discoveryMethod?: string; // 'stage1_homepage', 'stage2_heuristic', 'stage3_fallback', 'stage4_ai'
        aiServiceVersion?: string;
        retryCount?: number;
        confidence?: number; // 0-1
        extractionDuration?: number; // milliseconds
    } | null;
}
