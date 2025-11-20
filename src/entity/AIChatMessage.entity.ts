import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from 'typeorm';
import AuditableEntity from './Auditable.entity';
import { Order } from './order.decorator';
import { MessageType } from '@/entityTypes/commonType';

@Entity('ai_chat_messages')
@Index(['conversationId', 'timestamp'])
@Index(['role'])
export class AIChatMessageEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Order(1)
    @Column('varchar', { length: 100, nullable: false })
    messageId: string;

    @Order(2)
    @Column('varchar', { length: 100, default: 'default', nullable: false })
    conversationId: string;

    @Order(3)
    @Column('varchar', { length: 20, nullable: false })
    role: string; // 'user', 'assistant', 'system'

    @Order(4)
    @Column('text', { nullable: false })
    content: string;

    @Order(5)
    @Column('datetime', { nullable: false })
    timestamp: Date;

    @Order(6)
    @Column('varchar', { length: 100, nullable: true })
    model?: string;

    @Order(7)
    @Column('int', { nullable: true })
    tokensUsed?: number;

    @Order(8)
    @Column('text', { nullable: true })
    metadata?: string; // JSON string for additional data

    @Order(9)
    @Column({
        type: 'varchar',
        length: 20,
        default: MessageType.MESSAGE,
        nullable: false,
        enum: MessageType
    })
    messageType: MessageType;
}


