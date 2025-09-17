import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from 'typeorm';
import AuditableEntity from './Auditable.entity';
import { Order } from './order.decorator';

@Entity('rag_models')
@Index(['provider'])
@Index(['isActive'])
@Index(['name'])
export class RAGModelEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @Order(1)
    @Column('varchar', { length: 100, nullable: false })
    name: string;

    @Order(2)
    @Column('varchar', { length: 50, nullable: false })
    provider: string; // 'openai', 'huggingface', 'ollama', 'local'

    @Order(3)
    @Column('varchar', { length: 100, nullable: false })
    modelId: string; // Specific model identifier

    @Order(4)
    @Column('int', { nullable: false })
    dimensions: number; // Vector dimensions

    @Order(5)
    @Column('boolean', { default: false, nullable: false })
    isActive: boolean;

    // Configuration
    @Order(6)
    @Column('int', { nullable: true })
    maxTokens?: number;

    @Order(7)
    @Column('int', { nullable: true })
    chunkSize?: number;

    @Order(8)
    @Column('int', { nullable: true })
    overlapSize?: number;

    // Metadata
    @Order(9)
    @Column('varchar', { length: 20, nullable: true })
    version?: string;

    @Order(10)
    @Column('text', { nullable: true })
    description?: string;

    @Order(11)
    @Column('text', { nullable: true })
    capabilities?: string; // JSON string array of capabilities

    // Performance metrics
    @Order(12)
    @Column('float', { nullable: true })
    averageProcessingTime?: number; // in milliseconds

    @Order(13)
    @Column('int', { nullable: true })
    totalProcessedChunks?: number;

    @Order(14)
    @Column('float', { nullable: true })
    accuracyScore?: number; // 0-1 scale
}
