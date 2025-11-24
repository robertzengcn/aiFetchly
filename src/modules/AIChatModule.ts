import { BaseModule } from "@/modules/baseModule";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

export interface SaveMessageOptions {
    messageId: string;
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
    model?: string;
    tokensUsed?: number;
    metadata?: any;
    messageType?: MessageType;
}

export class AIChatModule extends BaseModule {
    private chatMessageModel: AIChatMessageModel;

    constructor() {
        super();
        this.chatMessageModel = new AIChatMessageModel(this.dbpath);
    }

    /**
     * Save a chat message to database
     */
    async saveMessage(options: SaveMessageOptions): Promise<AIChatMessageEntity> {
        const message = new AIChatMessageEntity();
        message.messageId = options.messageId;
        message.conversationId = options.conversationId;
        message.role = options.role;
        message.content = options.content;
        message.timestamp = options.timestamp || new Date();
        message.model = options.model;
        message.tokensUsed = options.tokensUsed;
        message.metadata = options.metadata ? JSON.stringify(options.metadata) : undefined;
        message.messageType = options.messageType || MessageType.MESSAGE;

        const messageId = await this.chatMessageModel.saveMessage(message);
        const savedMessage = await this.chatMessageModel.getMessageById(messageId);

        if (!savedMessage) {
            throw new Error('Failed to retrieve saved message');
        }

        return savedMessage;
    }

    /**
     * Get messages for a conversation
     */
    async getConversationMessages(
        conversationId: string,
        limit?: number,
        offset?: number
    ): Promise<AIChatMessageEntity[]> {
        return await this.chatMessageModel.getMessagesByConversation(conversationId, limit, offset);
    }

    /**
     * Get message by message ID
     */
    async getMessageByMessageId(messageId: string): Promise<AIChatMessageEntity | null> {
        return await this.chatMessageModel.getMessageByMessageId(messageId);
    }

    /**
     * Clear conversation history
     */
    async clearConversation(conversationId: string): Promise<number> {
        return await this.chatMessageModel.deleteConversation(conversationId);
    }

    /**
     * Clear all chat history
     */
    async clearAllHistory(): Promise<number> {
        return await this.chatMessageModel.deleteAllMessages();
    }

    /**
     * Get conversation statistics
     */
    async getStats(conversationId?: string): Promise<{
        totalMessages: number;
        totalConversations: number;
        messagesByRole: Record<string, number>;
    }> {
        return await this.chatMessageModel.getConversationStats(conversationId);
    }

    /**
     * Get all conversation IDs
     */
    async getAllConversations(): Promise<string[]> {
        return await this.chatMessageModel.getAllConversations();
    }

    /**
     * Get latest messages
     */
    async getLatestMessages(limit: number = 10): Promise<AIChatMessageEntity[]> {
        return await this.chatMessageModel.getLatestMessages(limit);
    }

    /**
     * Get all conversations with metadata (last message, timestamp, message count)
     */
    async getConversationsWithMetadata(): Promise<Array<{
        conversationId: string;
        lastMessage: string;
        lastMessageTimestamp: Date;
        messageCount: number;
        createdAt: Date;
    }>> {
        return await this.chatMessageModel.getConversationsWithMetadata();
    }
}


