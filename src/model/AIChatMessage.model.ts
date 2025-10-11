import { BaseDb } from "@/model/Basedb";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { Repository } from 'typeorm';

export class AIChatMessageModel extends BaseDb {
    public repository: Repository<AIChatMessageEntity>;

    constructor(dbpath: string) {
        super(dbpath);
        this.repository = this.sqliteDb.connection.getRepository(AIChatMessageEntity);
    }

    /**
     * Save a chat message to database
     */
    async saveMessage(message: AIChatMessageEntity): Promise<number> {
        const result = await this.repository.save(message);
        return result.id;
    }

    /**
     * Get messages for a conversation
     */
    async getMessagesByConversation(
        conversationId: string,
        limit?: number,
        offset?: number
    ): Promise<AIChatMessageEntity[]> {
        const query = this.repository
            .createQueryBuilder('message')
            .where('message.conversationId = :conversationId', { conversationId })
            .orderBy('message.timestamp', 'ASC');

        if (limit) {
            query.take(limit);
        }
        if (offset) {
            query.skip(offset);
        }

        return await query.getMany();
    }

    /**
     * Get message by ID
     */
    async getMessageById(id: number): Promise<AIChatMessageEntity | null> {
        return await this.repository.findOne({ where: { id } });
    }

    /**
     * Get message by message ID
     */
    async getMessageByMessageId(messageId: string): Promise<AIChatMessageEntity | null> {
        return await this.repository.findOne({ where: { messageId } });
    }

    /**
     * Delete all messages for a conversation
     */
    async deleteConversation(conversationId: string): Promise<number> {
        const result = await this.repository.delete({ conversationId });
        return result.affected || 0;
    }

    /**
     * Delete all chat messages
     */
    async deleteAllMessages(): Promise<number> {
        await this.repository.clear();
        return 1;
    }

    /**
     * Get conversation statistics
     */
    async getConversationStats(conversationId?: string): Promise<{
        totalMessages: number;
        totalConversations: number;
        messagesByRole: Record<string, number>;
    }> {
        let query = this.repository.createQueryBuilder('message');

        if (conversationId) {
            query = query.where('message.conversationId = :conversationId', { conversationId });
        }

        const messages = await query.getMany();
        const totalMessages = messages.length;

        // Count unique conversations
        const conversations = new Set(messages.map(m => m.conversationId));
        const totalConversations = conversations.size;

        // Count messages by role
        const messagesByRole: Record<string, number> = {};
        messages.forEach(m => {
            messagesByRole[m.role] = (messagesByRole[m.role] || 0) + 1;
        });

        return {
            totalMessages,
            totalConversations,
            messagesByRole
        };
    }

    /**
     * Get all conversation IDs
     */
    async getAllConversations(): Promise<string[]> {
        const result = await this.repository
            .createQueryBuilder('message')
            .select('DISTINCT message.conversationId', 'conversationId')
            .getRawMany();

        return result.map(r => r.conversationId);
    }

    /**
     * Get latest messages across all conversations
     */
    async getLatestMessages(limit: number = 10): Promise<AIChatMessageEntity[]> {
        return await this.repository
            .createQueryBuilder('message')
            .orderBy('message.timestamp', 'DESC')
            .take(limit)
            .getMany();
    }
}

