import { IProxyApi } from "./interface/IProxyApi";
import { ProxyModel } from "@/model/Proxy.model";
import { 
    ProxylistResp, 
    ProxyEntity as ProxyEntityType, 
    SaveProxyResp, 
    ProxyParseItem, 
    ImportProxyResp
} from "@/entityTypes/proxyType";
import { CommonApiresp } from "@/entityTypes/commonType";
import { BaseModule } from "./baseModule";

export class ProxyModule extends BaseModule implements IProxyApi {
    private proxyModel: ProxyModel;

    constructor() {
        super();
        this.proxyModel = new ProxyModel(this.dbpath);
    }

    /**
     * Get proxy list with pagination and search functionality
     */
    async getProxylist(page: number, size: number, search: string): Promise<ProxylistResp> {
        try {
            const result = await this.proxyModel.getProxyList(page, size, search);
            
            const response: ProxylistResp = {
                status: true,
                msg: "Success",
                data: {
                    total: result.total,
                    records: result.records
                }
            };
            
            return response;
        } catch (error) {
            const response: ProxylistResp = {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to get proxy list",
                data: {
                    total: 0,
                    records: []
                }
            };
            return response;
        }
    }

    /**
     * Delete a proxy by ID
     */
    async deleteProxy(id: number): Promise<any> {
        try {
            const success = await this.proxyModel.deleteProxy(id);
            
            if (success) {
                return {
                    status: true,
                    msg: "Proxy deleted successfully",
                    code: 200
                };
            } else {
                return {
                    status: false,
                    msg: "Proxy not found or already deleted",
                    code: 404
                };
            }
        } catch (error) {
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to delete proxy",
                code: 500
            };
        }
    }

    /**
     * Get proxy details by ID
     */
    async getProxyDetail(id: number): Promise<CommonApiresp<ProxyEntityType>> {
        try {
            const proxy = await this.proxyModel.getProxyById(id);
            
            if (proxy) {
                // Convert entity to type
                const proxyType: ProxyEntityType = {
                    id: proxy.id,
                    host: proxy.host,
                    port: proxy.port,
                    user: proxy.user,
                    pass: proxy.pass,
                    protocol: proxy.protocol,
                    country_code: proxy.country_code,
                    addtime: proxy.addtime
                };
                
                return {
                    status: true,
                    code: 200,
                    msg: "Success",
                    data: proxyType
                };
            } else {
                return {
                    status: false,
                    code: 404,
                    msg: "Proxy not found",
                    // data: null
                };
            }
        } catch (error) {
            return {
                status: false,
                code: 500,
                msg: error instanceof Error ? error.message : "Failed to get proxy details",
                // data: null
            };
        }
    }

    /**
     * Save or update a proxy entity
     */
    async saveProxy(entity: ProxyEntityType): Promise<SaveProxyResp> {
        try {
            // Check if proxy already exists (for new proxies)
            if (!entity.id) {
                const exists = await this.proxyModel.proxyExists(entity.host, entity.port);
                if (exists) {
                    return {
                        status: false,
                        code: 409,
                        msg: "Proxy with this host and port already exists",
                        data: { id: 0 }
                    };
                }
            }

            const savedProxy = await this.proxyModel.saveProxy(entity);
            
            return {
                status: true,
                code: 200,
                msg: entity.id ? "Proxy updated successfully" : "Proxy created successfully",
                data: { id: savedProxy.id }
            };
        } catch (error) {
            return {
                status: false,
                code: 500,
                msg: error instanceof Error ? error.message : "Failed to save proxy",
                data: { id: 0 }
            };
        }
    }

    /**
     * Import a list of proxies
     */
    async importProxy(data: Array<ProxyParseItem>): Promise<ImportProxyResp> {
        try {
            // Filter out duplicates more efficiently
            const uniqueProxies = await this.proxyModel.filterUniqueProxies(data);

            if (uniqueProxies.length === 0) {
                return {
                    status: false,
                    code: 409,
                    msg: "All proxies already exist in the database",
                    data: false
                };
            }

            const importedCount = await this.proxyModel.importProxies(uniqueProxies);
            
            return {
                status: true,
                code: 200,
                msg: `Successfully imported ${importedCount} proxies`,
                data: true
            };
        } catch (error) {
            return {
                status: false,
                code: 500,
                msg: error instanceof Error ? error.message : "Failed to import proxies",
                data: false
            };
        }
    }

    /**
     * Get the total count of proxies
     */
    async getProxycount(): Promise<number> {
        try {
            return await this.proxyModel.getProxyCount();
        } catch (error) {
            console.error("Failed to get proxy count:", error);
            return 0;
        }
    }
} 