import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { ProxyCheckEntity } from "@/entity/ProxyCheck.entity";
//import { proxyCheckStatus } from "./proxyCheckdb";

export enum proxyCheckStatus {
    Success = 1,
    Failure = 2,
}

export class ProxyCheckModel extends BaseDb {
    private repository: Repository<ProxyCheckEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(ProxyCheckEntity);
    }

    async updateProxyCheck(proxyId: number, status: proxyCheckStatus): Promise<void> {
        const recordtime = new Date().toISOString();
        
        // Check if proxy exists
        const existingProxy = await this.getProxyCheck(proxyId);
        
        if (!existingProxy) {
            // Create new record
            const newProxy = new ProxyCheckEntity();
            newProxy.proxy_id = proxyId;
            newProxy.status = status;
            newProxy.check_time = recordtime;
            await this.repository.save(newProxy);
        } else {
            // Update existing record
            existingProxy.status = status;
            existingProxy.check_time = recordtime;
            await this.repository.save(existingProxy);
        }
    }

    async getProxyCheck(proxyId: number): Promise<ProxyCheckEntity | null> {
        return this.repository.findOne({ where: { proxy_id: proxyId } });
    }

    async getProxyByStatus(status: proxyCheckStatus): Promise<Array<{ proxy_id: number }>> {
        const proxies = await this.repository.find({ 
            where: { status: status },
            select: ['proxy_id']
        });
        return proxies;
    }

    async deleteProxyCheck(proxyId: number): Promise<number> {
        const result = await this.repository.delete({ proxy_id: proxyId });
        return result.affected || 0;
    }
} 