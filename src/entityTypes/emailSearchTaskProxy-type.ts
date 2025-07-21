import { EmailSearchTaskProxyEntity } from "@/entity/EmailSearchTaskProxy.entity";

// Display type for EmailSearchTaskProxy
export interface EmailSearchTaskProxyDisplay {
    id: number;
    email_search_task_id: number;
    proxy_id: number;
    is_active: boolean;
    notes?: string;
    created_at?: string;
    updated_at?: string;
    // Related entities
    emailSearchTask?: {
        id: number;
        task_name?: string;
        status?: number;
    };
    proxy?: {
        id: number;
        host: string;
        port: string;
        protocol?: string;
        country_code?: string;
    };
}

// Create type for EmailSearchTaskProxy
export interface CreateEmailSearchTaskProxyRequest {
    taskId: number;
    proxyId: number;
    notes?: string;
}

// Update type for EmailSearchTaskProxy
export interface UpdateEmailSearchTaskProxyRequest {
    id: number;
    is_active?: boolean;
    notes?: string;
}

// Query type for EmailSearchTaskProxy
export interface EmailSearchTaskProxyQuery {
    taskId?: number;
    proxyId?: number;
    is_active?: boolean;
    page?: number;
    size?: number;
}

// Response type for EmailSearchTaskProxy operations
export interface EmailSearchTaskProxyResponse {
    status: boolean;
    message?: string;
    data?: EmailSearchTaskProxyDisplay | EmailSearchTaskProxyDisplay[];
    total?: number;
}

// Bulk operations
export interface BulkCreateEmailSearchTaskProxyRequest {
    taskId: number;
    proxyIds: number[];
    notes?: string;
}

export interface EmailSearchTaskProxyListResponse {
    records: EmailSearchTaskProxyDisplay[];
    total: number;
    page: number;
    size: number;
} 