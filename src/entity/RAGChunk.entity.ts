import "reflect-metadata";
import { Entity, Column, ManyToOne, JoinColumn, Index, PrimaryGeneratedColumn } from 'typeorm';
import AuditableEntity from './Auditable.entity';
import { Order } from './order.decorator';

@Entity('rag_chunks')
@Index(['documentId'])
@Index(['chunkIndex'])
@Index(['embeddingId'])
@Index(['contentHash'])
export class RAGChunkEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @Order(1)
    @Column('int', { nullable: false })
    documentId: number;

    @Order(2)
    @Column('int', { nullable: false })
    chunkIndex: number;

    @Order(3)
    @Column('text', { nullable: false })
    content: string;

    @Order(4)
    @Column('varchar', { length: 64, nullable: false })
    contentHash: string; // SHA-256 hash for deduplication

    @Order(5)
    @Column('int', { nullable: false, default: 0 })
    tokenCount: number;

    // Vector fields
    @Order(6)
    @Column('varchar', { length: 100, nullable: true })
    embeddingId?: string; // Reference to embedding in vector store

    @Order(7)
    @Column('int', { nullable: true })
    vectorDimensions?: number;

    // Metadata
    @Order(8)
    @Column('int', { nullable: true })
    startPosition?: number;

    @Order(9)
    @Column('int', { nullable: true })
    endPosition?: number;

    @Order(10)
    @Column('int', { nullable: true })
    pageNumber?: number;

    // Relationships
    @ManyToOne('RAGDocumentEntity', 'chunks', { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'documentId' })
    document?: any;
}
