import { ProxylistResp, ProxyEntity, SaveProxyResp, ProxyParseItem, ImportProxyResp, GetProxyCountResp } from "@/entityTypes/proxyType";
import { CommonApiresp } from "@/entityTypes/commonType";

export interface IProxyApi {
  /**
   * Get proxy list with pagination and search functionality
   * @param page - Page number for pagination
   * @param size - Number of items per page
   * @param search - Search term to filter proxies
   * @returns Promise<ProxylistResp> - Paginated proxy list response
   */
  getProxylist(page: number, size: number, search: string): Promise<ProxylistResp>;

  /**
   * Delete a proxy by ID
   * @param id - Proxy ID to delete
   * @returns Promise<any> - Delete operation response
   */
  deleteProxy(id: number): Promise<any>;

  /**
   * Get proxy details by ID
   * @param id - Proxy ID to retrieve details for
   * @returns Promise<CommonApiresp<ProxyEntity>> - Proxy details response
   */
  getProxyDetail(id: number): Promise<CommonApiresp<ProxyEntity>>;

  /**
   * Save or update a proxy entity
   * @param entity - Proxy entity to save
   * @returns Promise<SaveProxyResp> - Save operation response
   */
  saveProxy(entity: ProxyEntity): Promise<SaveProxyResp>;

  /**
   * Import a list of proxies
   * @param data - Array of proxy items to import
   * @returns Promise<ImportProxyResp> - Import operation response
   */
  importProxy(data: Array<ProxyParseItem>): Promise<ImportProxyResp>;

  /**
   * Get the total count of proxies
   * @returns Promise<number> - Total number of proxies
   */
  getProxycount(): Promise<number>;
} 