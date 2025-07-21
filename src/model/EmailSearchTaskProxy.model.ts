import { Repository } from "typeorm";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailSearchTaskProxyEntity } from "@/entity/EmailSearchTaskProxy.entity";
import { IEmailSearchTaskProxyModuleInterface } from "@/modules/interface/IEmailSearchTaskProxyModuleInterface";

export class EmailSearchTaskProxyModel implements IEmailSearchTaskProxyModuleInterface {
    private repository: Repository<EmailSearchTaskProxyEntity>;

    constructor() {
        const db = SqliteDb.getInstance("");
        this.repository = db.connection.getRepository(EmailSearchTaskProxyEntity);
    }

    // Create operations
    async createEmailSearchTaskProxy(taskId: number, proxyId: number, notes?: string): Promise<EmailSearchTaskProxyEntity> {
        const emailSearchTaskProxy = new EmailSearchTaskProxyEntity();
        emailSearchTaskProxy.email_search_task_id = taskId;
        emailSearchTaskProxy.proxy_id = proxyId;
        emailSearchTaskProxy.is_active = true;
        emailSearchTaskProxy.notes = notes;
        
        return await this.repository.save(emailSearchTaskProxy);
    }

    // Read operations
    async getEmailSearchTaskProxyById(id: number): Promise<EmailSearchTaskProxyEntity | null> {
        return await this.repository.findOne({
            where: { id },
            relations: ['emailSearchTask', 'proxy']
        });
    }

    async getEmailSearchTaskProxiesByTaskId(taskId: number): Promise<EmailSearchTaskProxyEntity[]> {
        return await this.repository.find({
            where: { email_search_task_id: taskId },
            relations: ['emailSearchTask', 'proxy'],
            order: { createdAt: 'DESC' }
        });
    }

    async getEmailSearchTaskProxiesByProxyId(proxyId: number): Promise<EmailSearchTaskProxyEntity[]> {
        return await this.repository.find({
            where: { proxy_id: proxyId },
            relations: ['emailSearchTask', 'proxy'],
            order: { createdAt: 'DESC' }
        });
    }

    async getAllEmailSearchTaskProxies(): Promise<EmailSearchTaskProxyEntity[]> {
        return await this.repository.find({
            relations: ['emailSearchTask', 'proxy'],
            order: { createdAt: 'DESC' }
        });
    }

    // Update operations
    async updateEmailSearchTaskProxy(id: number, updates: Partial<EmailSearchTaskProxyEntity>): Promise<EmailSearchTaskProxyEntity | null> {
        const existing = await this.repository.findOne({ where: { id } });
        if (!existing) {
            return null;
        }

        Object.assign(existing, updates);
        return await this.repository.save(existing);
    }

    async updateEmailSearchTaskProxyByTaskId(taskId: number, updates: Partial<EmailSearchTaskProxyEntity>): Promise<EmailSearchTaskProxyEntity[]> {
        const existing = await this.repository.find({ where: { email_search_task_id: taskId } });
        if (existing.length === 0) {
            return [];
        }

        const updated = existing.map(item => {
            Object.assign(item, updates);
            return item;
        });

        return await this.repository.save(updated);
    }

    // Delete operations
    async deleteEmailSearchTaskProxy(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return (result.affected ?? 0) > 0;
    }

    async deleteEmailSearchTaskProxyByTaskId(taskId: number): Promise<boolean> {
        const result = await this.repository.delete({ email_search_task_id: taskId });
        return (result.affected ?? 0) > 0;
    }

    async deleteEmailSearchTaskProxyByProxyId(proxyId: number): Promise<boolean> {
        const result = await this.repository.delete({ proxy_id: proxyId });
        return (result.affected ?? 0) > 0;
    }

    // Utility operations
    async isEmailSearchTaskProxyExists(taskId: number, proxyId: number): Promise<boolean> {
        const count = await this.repository.count({
            where: {
                email_search_task_id: taskId,
                proxy_id: proxyId
            }
        });
        return count > 0;
    }

    async activateEmailSearchTaskProxy(id: number): Promise<boolean> {
        const result = await this.repository.update(id, { is_active: true });
        return (result.affected ?? 0) > 0;
    }

    async deactivateEmailSearchTaskProxy(id: number): Promise<boolean> {
        const result = await this.repository.update(id, { is_active: false });
        return (result.affected ?? 0) > 0;
    }
} 