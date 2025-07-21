import { EmailSearchTaskProxyModel } from "@/model/EmailSearchTaskProxy.model";
import { IEmailSearchTaskProxyModuleInterface } from "@/modules/interface/IEmailSearchTaskProxyModuleInterface";
import { EmailSearchTaskProxyEntity } from "@/entity/EmailSearchTaskProxy.entity";

export class EmailSearchTaskProxyModule implements IEmailSearchTaskProxyModuleInterface {
    private model: EmailSearchTaskProxyModel;

    constructor() {
        this.model = new EmailSearchTaskProxyModel();
    }

    // Create operations
    async createEmailSearchTaskProxy(taskId: number, proxyId: number, notes?: string): Promise<EmailSearchTaskProxyEntity> {
        // Check if relationship already exists
        const exists = await this.model.isEmailSearchTaskProxyExists(taskId, proxyId);
        if (exists) {
            throw new Error(`Email search task proxy relationship already exists for task ${taskId} and proxy ${proxyId}`);
        }

        return await this.model.createEmailSearchTaskProxy(taskId, proxyId, notes);
    }

    // Read operations
    async getEmailSearchTaskProxyById(id: number): Promise<EmailSearchTaskProxyEntity | null> {
        return await this.model.getEmailSearchTaskProxyById(id);
    }

    async getEmailSearchTaskProxiesByTaskId(taskId: number): Promise<EmailSearchTaskProxyEntity[]> {
        return await this.model.getEmailSearchTaskProxiesByTaskId(taskId);
    }

    async getEmailSearchTaskProxiesByProxyId(proxyId: number): Promise<EmailSearchTaskProxyEntity[]> {
        return await this.model.getEmailSearchTaskProxiesByProxyId(proxyId);
    }

    async getAllEmailSearchTaskProxies(): Promise<EmailSearchTaskProxyEntity[]> {
        return await this.model.getAllEmailSearchTaskProxies();
    }

    // Update operations
    async updateEmailSearchTaskProxy(id: number, updates: Partial<EmailSearchTaskProxyEntity>): Promise<EmailSearchTaskProxyEntity | null> {
        return await this.model.updateEmailSearchTaskProxy(id, updates);
    }

    async updateEmailSearchTaskProxyByTaskId(taskId: number, updates: Partial<EmailSearchTaskProxyEntity>): Promise<EmailSearchTaskProxyEntity[]> {
        return await this.model.updateEmailSearchTaskProxyByTaskId(taskId, updates);
    }

    // Delete operations
    async deleteEmailSearchTaskProxy(id: number): Promise<boolean> {
        return await this.model.deleteEmailSearchTaskProxy(id);
    }

    async deleteEmailSearchTaskProxyByTaskId(taskId: number): Promise<boolean> {
        return await this.model.deleteEmailSearchTaskProxyByTaskId(taskId);
    }

    async deleteEmailSearchTaskProxyByProxyId(proxyId: number): Promise<boolean> {
        return await this.model.deleteEmailSearchTaskProxyByProxyId(proxyId);
    }

    // Utility operations
    async isEmailSearchTaskProxyExists(taskId: number, proxyId: number): Promise<boolean> {
        return await this.model.isEmailSearchTaskProxyExists(taskId, proxyId);
    }

    async activateEmailSearchTaskProxy(id: number): Promise<boolean> {
        return await this.model.activateEmailSearchTaskProxy(id);
    }

    async deactivateEmailSearchTaskProxy(id: number): Promise<boolean> {
        return await this.model.deactivateEmailSearchTaskProxy(id);
    }

    // Additional business logic methods
    async getActiveEmailSearchTaskProxiesByTaskId(taskId: number): Promise<EmailSearchTaskProxyEntity[]> {
        const allProxies = await this.model.getEmailSearchTaskProxiesByTaskId(taskId);
        return allProxies.filter(proxy => proxy.is_active);
    }

    async getActiveEmailSearchTaskProxiesByProxyId(proxyId: number): Promise<EmailSearchTaskProxyEntity[]> {
        const allTasks = await this.model.getEmailSearchTaskProxiesByProxyId(proxyId);
        return allTasks.filter(task => task.is_active);
    }

    async bulkCreateEmailSearchTaskProxies(taskId: number, proxyIds: number[], notes?: string): Promise<EmailSearchTaskProxyEntity[]> {
        const results: EmailSearchTaskProxyEntity[] = [];
        
        for (const proxyId of proxyIds) {
            try {
                const result = await this.createEmailSearchTaskProxy(taskId, proxyId, notes);
                results.push(result);
            } catch (error) {
                console.warn(`Failed to create proxy relationship for task ${taskId} and proxy ${proxyId}:`, error);
            }
        }
        
        return results;
    }

    async deactivateAllEmailSearchTaskProxiesByTaskId(taskId: number): Promise<boolean> {
        const proxies = await this.model.getEmailSearchTaskProxiesByTaskId(taskId);
        const activeProxies = proxies.filter(proxy => proxy.is_active);
        
        for (const proxy of activeProxies) {
            await this.model.deactivateEmailSearchTaskProxy(proxy.id);
        }
        
        return true;
    }
} 