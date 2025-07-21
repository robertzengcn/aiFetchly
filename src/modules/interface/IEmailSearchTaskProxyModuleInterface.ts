import { EmailSearchTaskProxyEntity } from "@/entity/EmailSearchTaskProxy.entity";

export interface IEmailSearchTaskProxyModuleInterface {
    // Create operations
    createEmailSearchTaskProxy(taskId: number, proxyId: number, notes?: string): Promise<EmailSearchTaskProxyEntity>;
    
    // Read operations
    getEmailSearchTaskProxyById(id: number): Promise<EmailSearchTaskProxyEntity | null>;
    getEmailSearchTaskProxiesByTaskId(taskId: number): Promise<EmailSearchTaskProxyEntity[]>;
    getEmailSearchTaskProxiesByProxyId(proxyId: number): Promise<EmailSearchTaskProxyEntity[]>;
    getAllEmailSearchTaskProxies(): Promise<EmailSearchTaskProxyEntity[]>;
    
    // Update operations
    updateEmailSearchTaskProxy(id: number, updates: Partial<EmailSearchTaskProxyEntity>): Promise<EmailSearchTaskProxyEntity | null>;
    updateEmailSearchTaskProxyByTaskId(taskId: number, updates: Partial<EmailSearchTaskProxyEntity>): Promise<EmailSearchTaskProxyEntity[]>;
    
    // Delete operations
    deleteEmailSearchTaskProxy(id: number): Promise<boolean>;
    deleteEmailSearchTaskProxyByTaskId(taskId: number): Promise<boolean>;
    deleteEmailSearchTaskProxyByProxyId(proxyId: number): Promise<boolean>;
    
    // Utility operations
    isEmailSearchTaskProxyExists(taskId: number, proxyId: number): Promise<boolean>;
    activateEmailSearchTaskProxy(id: number): Promise<boolean>;
    deactivateEmailSearchTaskProxy(id: number): Promise<boolean>;
} 