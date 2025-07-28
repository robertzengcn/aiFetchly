import { SocialAccountModel } from "@/model/SocialAccount.model";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import { ProxyEntity } from "@/entity/Proxy.entity";
import { BaseModule } from "@/modules/baseModule";
import { SocialAccountResponse, SocialAccountDetailResponse, SocialAccountDetailData, SavesocialaccountResp } from "@/entityTypes/socialaccount-type";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { ProxyModule } from "./ProxyModule";

export class SocialAccountModule extends BaseModule {
    private socialAccountModel: SocialAccountModel;
    private accountCookiesModule: AccountCookiesModule;

    constructor() {
        super();
        this.socialAccountModel = new SocialAccountModel(this.dbpath);
        this.accountCookiesModule = new AccountCookiesModule();
    }

    /**
     * Get social account list with pagination and search
     */
    public async getSocialAccountList(
        page: number,
        size: number,
        search: string,
        platform?: number
    ): Promise<SocialAccountResponse> {
        try {
            const result = await this.socialAccountModel.getSocialAccountList(page, size, search, platform);
            
            // Add cookies information to each account
            const recordsWithCookies = await Promise.all(
                result.records.map(async (account) => {
                    const cookies = await this.accountCookiesModule.getAccountCookies(account.id);
                    const hasCookies = !!(cookies && cookies.cookies && JSON.parse(cookies.cookies).length > 0);
                    
                    return {
                        id: account.id,
                        social_type: account.social_type,
                        social_type_id: account.social_type_id,
                        user: account.user,
                        pass: account.pass,
                        status: account.status,
                        use_proxy: account.proxy && account.proxy.length > 0 ? 1 : 0,
                        cookies: hasCookies
                    };
                })
            );

            return {
                status: "success",
                msg: "Social accounts retrieved successfully",
                data: {
                    total: result.total,
                    records: recordsWithCookies
                }
            };
        } catch (error) {
            return {
                status: "error",
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: {
                    total: 0,
                    records: []
                }
            };
        }
    }

    /**
     * Get social account detail by ID
     */
    public async getAccountDetail(id: number): Promise<SocialAccountDetailResponse> {
        try {
            const account = await this.socialAccountModel.getSocialAccountById(id);
            
            if (!account) {
                return {
                    status: "error",
                    msg: "Social account not found",
                    data: null as any
                };
            }

            // Convert to SocialAccountDetailData format
            const detailData: SocialAccountDetailData = {
                id: account.id,
                social_type: account.social_type,
                social_type_id: account.social_type_id,
                social_type_url: account.social_type_url,
                user: account.user,
                pass: account.pass,
                status: account.status,
                name: account.name,
                phone: account.phone,
                email: account.email,
                proxy: account.proxy || []
            };

            return {
                status: "success",
                msg: "Social account detail retrieved successfully",
                data: detailData
            };
        } catch (error) {
            return {
                status: "error",
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null as any
            };
        }
    }

    /**
     * Save social account
     */
    public async saveSocialAccount(socialAccountData: SocialAccountDetailData): Promise<SavesocialaccountResp> {
        try {
            const socialAccount = new SocialAccountEntity();
            
            // Map the data
            if (socialAccountData.id) {
                socialAccount.id = socialAccountData.id;
            }
            if (socialAccountData.social_type) {
                socialAccount.social_type = socialAccountData.social_type;
            }
            if (socialAccountData.social_type_id) {
                socialAccount.social_type_id = socialAccountData.social_type_id;
            }
            if (socialAccountData.social_type_url) {
                socialAccount.social_type_url = socialAccountData.social_type_url;
            }
            socialAccount.user = socialAccountData.user;
            if (socialAccountData.pass) {
                socialAccount.pass = socialAccountData.pass;
            }
            socialAccount.status = socialAccountData.status;
            socialAccount.name = socialAccountData.name;
            if (socialAccountData.phone) {
                socialAccount.phone = socialAccountData.phone;
            }
            if (socialAccountData.email) {
                socialAccount.email = socialAccountData.email;
            }
            if (socialAccountData.proxy) {
                // Convert Proxy[] to ProxyEntity[] by finding existing proxy entities
                const proxyEntities = await Promise.all(
                    
                    socialAccountData.proxy.map(async (proxy) => {
                        if (proxy.id) {
                            // Find existing proxy entity by ID
                            // const existingProxy = await this.sqliteDb.connection
                            //     .getRepository(ProxyEntity)
                            //     .findOne({ where: { id: proxy.id } });
                            // return existingProxy;
                            const proxyModule = new ProxyModule();
                            const proxyDetail = await proxyModule.getProxyDetail(proxy.id);
                            return proxyDetail.data;
                        }
                        return null;
                    })
                );
                socialAccount.proxy = proxyEntities.filter(p => p !== null) as ProxyEntity[];
            }

            const savedId = await this.socialAccountModel.saveSocialAccount(socialAccount);

            return {
                status: true,
                msg: "Social account saved successfully",
                data: { id: savedId }
            };
        } catch (error) {
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: { id: 0 }
            };
        }
    }

    /**
     * Delete social account
     */
    public async deleteAccount(id: number): Promise<{ status: boolean; msg: string }> {
        try {
            const affectedRows = await this.socialAccountModel.deleteSocialAccount(id);
            
            if (affectedRows > 0) {
                // Also delete associated cookies
                await this.accountCookiesModule.deleteCookies(id);
                
                return {
                    status: true,
                    msg: "Social account deleted successfully"
                };
            } else {
                return {
                    status: false,
                    msg: "Social account not found"
                };
            }
        } catch (error) {
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
        }
    }

    /**
     * Get all social accounts
     */
    public async getAllSocialAccounts(): Promise<SocialAccountEntity[]> {
        return this.socialAccountModel.getAllSocialAccounts();
    }

    /**
     * Get social accounts by status
     */
    public async getSocialAccountsByStatus(status: number): Promise<SocialAccountEntity[]> {
        return this.socialAccountModel.getSocialAccountsByStatus(status);
    }

    /**
     * Get social accounts by platform
     */
    public async getSocialAccountsByPlatform(socialTypeId: number): Promise<SocialAccountEntity[]> {
        return this.socialAccountModel.getSocialAccountsByPlatform(socialTypeId);
    }
} 