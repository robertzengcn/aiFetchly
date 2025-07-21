import { BaseDb } from "./Basedb";
import { Repository } from "typeorm";
import { ProxyEntity } from "@/entity/Proxy.entity";
import { ProxyListEntity } from "@/entityTypes/proxyType";

export class ProxyModel extends BaseDb {
    private repository: Repository<ProxyEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(ProxyEntity);
    }

    /**
     * Get proxy list with pagination and search
     */
    async getProxyList(page: number, size: number, search: string): Promise<{ total: number; records: ProxyListEntity[] }> {
        const queryBuilder = this.repository.createQueryBuilder("proxy");
        
        if (search && search.trim().length > 0) {
            queryBuilder.where(
                "proxy.host LIKE :search OR proxy.port LIKE :search OR proxy.user LIKE :search OR proxy.protocol LIKE :search",
                { search: `%${search}%` }
            );
        }
        
        const total = await queryBuilder.getCount();
        
        const records = await queryBuilder
            .skip((page - 1) * size)
            .take(size)
            .orderBy("proxy.createdAt", "DESC")
            .getMany();
        
        // Convert to ProxyListEntity format
        const proxyListEntities: ProxyListEntity[] = records.map(proxy => ({
            id: proxy.id,
            host: proxy.host,
            port: proxy.port,
            username: proxy.user,
            password: proxy.pass,
            protocol: proxy.protocol,
            country_code: proxy.country_code,
            addtime: proxy.addtime || "",
            checktime: proxy.updatedAt?.toISOString(),
            status: 1, // Default status
            statusName: "Active"
        }));
        
        return {
            total,
            records: proxyListEntities
        };
    }

    /**
     * Get proxy by ID
     */
    async getProxyById(id: number): Promise<ProxyEntity | null> {
        return await this.repository.findOne({ where: { id } });
    }

    /**
     * Save or update proxy
     */
    async saveProxy(proxyData: Partial<ProxyEntity>): Promise<ProxyEntity> {
        if (proxyData.id) {
            // Update existing proxy
            await this.repository.update(proxyData.id, proxyData);
            return await this.getProxyById(proxyData.id) as ProxyEntity;
        } else {
            // Create new proxy
            const proxy = this.repository.create(proxyData);
            return await this.repository.save(proxy);
        }
    }

    /**
     * Delete proxy by ID
     */
    async deleteProxy(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return result.affected ? result.affected > 0 : false;
    }

    /**
     * Get total count of proxies
     */
    async getProxyCount(): Promise<number> {
        return await this.repository.count();
    }

    /**
     * Import multiple proxies
     */
    async importProxies(proxies: Array<{ host: string; port: string; user?: string; pass?: string; protocol?: string }>): Promise<number> {
        const proxyEntities = proxies.map(proxy => 
            this.repository.create({
                host: proxy.host,
                port: proxy.port,
                user: proxy.user,
                pass: proxy.pass,
                protocol: proxy.protocol
            })
        );
        
        const result = await this.repository.save(proxyEntities);
        return result.length;
    }

    /**
     * Check if proxy exists by host and port
     */
    async proxyExists(host: string, port: string): Promise<boolean> {
        const count = await this.repository.count({
            where: { host, port }
        });
        return count > 0;
    }

    /**
     * Filter out proxies that already exist in the database
     */
    async filterUniqueProxies(proxies: Array<{ host: string; port: string; user?: string; pass?: string; protocol?: string }>): Promise<Array<{ host: string; port: string; user?: string; pass?: string; protocol?: string }>> {
        const uniqueProxies:Array<{ host: string; port: string; user?: string; pass?: string; protocol?: string }> = [];
        
        // Get all existing host:port combinations in one query
        const existingProxies = await this.repository.find({
            select: ['host', 'port']
        });
        const existingSet = new Set(existingProxies.map(p => `${p.host}:${p.port}`));
        
        // Filter out duplicates
        for (const proxy of proxies) {
            const key = `${proxy.host}:${proxy.port}`;
            if (!existingSet.has(key)) {
                uniqueProxies.push(proxy);
            }
        }
        
        return uniqueProxies;
    }
} 