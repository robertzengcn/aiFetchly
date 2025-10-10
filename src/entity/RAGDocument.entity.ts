import "reflect-metadata";
import { Entity, Column, OneToMany, Index, PrimaryGeneratedColumn } from 'typeorm';
import AuditableEntity from './Auditable.entity';
import { Order } from './order.decorator';

@Entity('rag_documents')
@Index(['status', 'processingStatus'])
@Index(['fileType'])
@Index(['uploadedAt'])
export class RAGDocumentEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @Order(1)
    @Column('varchar', { length: 255, nullable: false })
    name: string;

    @Order(2)
    @Column('varchar', { length: 500, nullable: false })
    filePath: string;

    @Order(3)
    @Column('varchar', { length: 50, nullable: false })
    fileType: string;

    @Order(4)
    @Column('bigint', { nullable: false })
    fileSize: number;

    @Order(5)
    @Column('varchar', { length: 20, default: 'active', nullable: false })
    status: string; // 'active', 'archived', 'deleted'

    @Order(6)
    @Column('varchar', { length: 20, default: 'pending', nullable: false })
    processingStatus: string; // 'pending', 'processing', 'completed', 'failed'

    // Metadata fields
    @Order(7)
    @Column('varchar', { length: 500, nullable: true })
    title?: string;

    @Order(8)
    @Column('text', { nullable: true })
    description?: string;

    @Order(9)
    @Column('text', { nullable: true })
    tags?: string; // JSON string array

    @Order(10)
    @Column('varchar', { length: 255, nullable: true })
    author?: string;

    // Timestamps
    @Order(11)
    @Column('datetime', { nullable: true })
    uploadedAt?: Date;

    @Order(12)
    @Column('datetime', { nullable: true })
    processedAt?: Date;

    @Order(13)
    @Column('datetime', { nullable: true })
    lastAccessedAt?: Date;

    // Vector database index path
    @Order(14)
    @Column('varchar', { length: 500, nullable: true })
    vectorIndexPath?: string;

    // Relationships
    @OneToMany('RAGChunkEntity', 'document')
    chunks?: any[];
}
