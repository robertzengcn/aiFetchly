import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';
import AuditableEntity from './Auditable.entity';
import { Order } from './order.decorator';
import { VectorTransformer } from '@/utils/VectorTransformer';

/**
 * Vector entity for storing embeddings in SQLite with sqlite-vec
 * Uses TypeORM with vector transformer for Float32Array <-> Buffer conversion
 * Supports sqlite-vec Virtual Table Engine (vec0) for optimized vector search
 */
@Entity('vectors')
@Index(['chunk_id'])
export class VectorEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Order(1)
    @Column('int', { nullable: false })
    chunk_id: number;

    @Order(2)
    @Column({
        type: 'blob', // Stored as BLOB in SQLite
        transformer: new VectorTransformer(), // Use our custom transformer
        nullable: false,
    })
    embedding: Float32Array; // Used as Float32Array in our app
}

/**
 * Vector metadata entity for storing index metadata including model, dimension, and virtual table name
 */
@Entity('vector_metadata')
@Index(['model_name', 'dimension'])
export class VectorMetadataEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Order(1)
    @Column('int', { nullable: false })
    dimension: number;

    @Order(2)
    @Column('int', { nullable: false, default: 0 })
    total_vectors: number;

    @Order(3)
    @Column('varchar', { length: 255, nullable: false })
    model_name: string;

    @Order(4)
    @Column('varchar', { length: 50, nullable: false, default: 'flat' })
    index_type: string;

    @Order(5)
    @Column('varchar', { length: 255, nullable: false, unique: true })
    virtual_table_name: string;
}

