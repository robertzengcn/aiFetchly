//import { SocialAccount } from "@/modules/socialaccount";
import { BrowserWindow } from 'electron';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const session = require('electron').session;
import { ProxyParseItem } from "@/entityTypes/proxyType";
import { proxyEntityToUrl } from "@/modules/lib/function"
import { convertNetscapeCookiesToJson } from "@/modules/lib/function"
import { CookiesType } from "@/entityTypes/cookiesType"
import { SocialAccountModule } from "@/modules/socialAccountModule"
import { SocialPlatformList } from "@/config/generate"
import { AccountSessionService, CookieServiceError } from "@/modules/AccountSessionService";
import { log } from "@/modules/Logger";
import { SavesocialaccountResp, SocialAccountDetailData, SocialAccountDetailResponse, SocialAccountResponse } from "@/entityTypes/socialaccount-type"

/**
 * Social-account controller.
 *
 * Cookie persistence is delegated to AccountSessionService: it owns the stable
 * per-account Electron partition, multi-domain SSO capture, encryption, and
 * migration. This controller never parses plaintext cookie JSON, never logs
 * cookie values, and never generates random partitions.
 */
export class SocialAccountController {
    private socialaccountModel: SocialAccountModule
    private accountSessionService: AccountSessionService

    constructor() {
        this.socialaccountModel = new SocialAccountModule()
        this.accountSessionService = new AccountSessionService()
    }

    private getSocialPlatformUrl(socialTypeId: number): string | null {
        const platform = SocialPlatformList.find(item => item.id === socialTypeId)
        return platform ? platform.url : null
    }

    //get social account detail from local database
    public async getAccountdetail(
        id: number
    ): Promise<SocialAccountDetailResponse> {
        return await this.socialaccountModel.getAccountDetail(id);
    }

    /**
     * Decide how to open an account: if a usable session snapshot exists, open
     * the platform window with it; otherwise prompt the user to upload a cookie
     * file (Google/YouTube) or sign in manually (other platforms).
     */
    public async showSocialaccountMsg(id: number, platform: string, gmsgCallback?: () => void, omsgCallback?: () => void, closeFun?: () => void): Promise<void> {
        const snapshot = await this.accountSessionService.getDecryptedSnapshot(id);
        if (snapshot.cookies.length === 0) {
            const platformLower = platform.toLowerCase();
            if (platformLower.includes("google1") || platformLower.includes("youtube1")) {
                if (gmsgCallback) {
                    gmsgCallback()
                }
                return
            } else {
                if (omsgCallback) {
                    omsgCallback()
                }
            }
        } else {
            await this.showSocialmediaWin(id, closeFun)
        }
    }

    /**
     * Open a pop-up window to show social media and allow the user to log in.
     * Reuses the account's stable persistent partition, applies the stored
     * (decrypted) cookie snapshot before load, and captures all allowlisted
     * cookies (multi-domain SSO) on close through the encrypted storage layer.
     */
    public async showSocialmediaWin(id: number, closeFun?: () => void): Promise<void> {
        const accinfo = await this.socialaccountModel.getAccountDetail(id)
        if (!accinfo || !accinfo.data.id) {
            throw new Error("get account info failed")
        }
        if (!accinfo.status) {
            throw new Error(accinfo.msg)
        }

        const partitionPath = await this.accountSessionService.getOrCreatePartition(id)
        const ses = session.fromPartition(partitionPath)

        let winTitle = ""
        if (accinfo.data.social_type) {
            winTitle = accinfo.data.social_type
        }
        if (accinfo.data.proxy) {
            const randomProxy = accinfo.data.proxy[Math.floor(Math.random() * accinfo.data.proxy.length)];
            if (randomProxy) {
                if (randomProxy.host && randomProxy.port) {
                    winTitle += " Use proxy host:" + randomProxy.host + " port:" + randomProxy.port
                    const proxyitem: ProxyParseItem = {
                        host: randomProxy.host,
                        port: randomProxy.port,
                        user: randomProxy.username,
                        pass: randomProxy.password,
                        protocol: randomProxy.protocol
                    }
                    const proxyUrl = proxyEntityToUrl(proxyitem)
                    ses.setProxy({ proxyRules: proxyUrl }).then(() => {
                        log.info(`set proxy success for account ${id} host:${randomProxy.host} port:${randomProxy.port}`)
                    }).catch((error: Error) => {
                        log.warn(`set proxy failed for account ${id}: ${error.message}`)
                    })
                }
            }
        }

        // Apply the stored, decrypted snapshot (multi-domain) before navigation.
        await this.accountSessionService.applySnapshotToSession(id, ses)

        const win: BrowserWindow = new BrowserWindow({
            autoHideMenuBar: true, webPreferences: {
                session: ses
            }
        });
        win.setTitle(winTitle);
        win.setMenu(null);

        const socialTypeUrl = accinfo.data.social_type_id ? this.getSocialPlatformUrl(accinfo.data.social_type_id) : null
        if (!socialTypeUrl) {
            throw new Error("social type url not exist")
        }
        await win.loadURL(socialTypeUrl).catch((error: Error) => {
            const ignoreMsg = ["Message 0 rejected by interface blink.mojom.WidgetHost", "ERR_FAILED (-2)"]
            if (!ignoreMsg.some(msg => error.message.includes(msg))) {
                log.warn(`load url failed for account ${id}: ${error.message}`)
                win.close()
                throw new Error('load url failed, error:' + error.message)
            }
        })

        win.once('ready-to-show', () => {
            win.show()
        });

        // Capture ALL allowlisted cookies (not just one landing-page URL) on
        // close, persist them encrypted, and only then signal success. The
        // try/finally lets the window finish closing even if persistence fails.
        win.on('close', async () => {
            try {
                const winsession = (win as unknown as { webContents?: { session?: unknown } }).webContents?.session as
                    | Parameters<AccountSessionService["captureSessionSnapshot"]>[1]
                    | undefined
                if (winsession) {
                    await this.accountSessionService.captureSessionSnapshot(id, winsession)
                }
            } catch (err) {
                // Never log cookie details; record account + safe code only.
                const code = err instanceof CookieServiceError ? err.code : "SESSION_CAPTURE_FAILED"
                log.warn(`session capture failed for account ${id} (${code})`)
            } finally {
                if (closeFun) {
                    closeFun()
                }
            }
        });
    }

    /**
     * Import cookies from a Netscape .txt file. Read access (not write) is
     * checked; parsed cookies are validated against the account's platform
     * manifest and persisted through the encrypted storage layer. Returns the
     * number of accepted cookies (0 => nothing imported).
     */
    public async handleCookiesfile(filePath: string, accountId: number): Promise<number> {
        const cookiesArr: CookiesType[] = convertNetscapeCookiesToJson(filePath)
        const partitionPath = await this.accountSessionService.getOrCreatePartition(accountId)
        try {
            const outcome = await this.accountSessionService.persistSnapshot({
                accountId,
                cookies: cookiesArr as unknown[],
                source: "netscape_file",
                partitionPath,
            })
            return outcome.importedCookieCount
        } catch (err) {
            if (err instanceof CookieServiceError) {
                log.warn(`netscape import rejected for account ${accountId} (${err.code})`)
                return 0
            }
            throw err
        }
    }

    /**
     * Clear the account's encrypted cookie snapshot and its Electron partition
     * storage. Idempotent; scoped to this account only.
     */
    public async cleanCookies(accountId: number): Promise<void> {
        await this.accountSessionService.clearAccountSession(accountId)
    }

    public convertPlatform(name: string): number {
        const lowerCaseName = name.toLowerCase();
        const platform = SocialPlatformList.find(item =>
            item.name.toLowerCase().includes(lowerCaseName) ||
            lowerCaseName.includes(item.name.toLowerCase())
        );
        if (platform) {
            return platform.id;
        } else {
            throw new Error(`Unknown platform name: ${name}`);
        }
    }

    //get social account list from local database
    public async getSocialaccountlist(
        page: number,
        size: number,
        search: string,
        platform?: number,
    ): Promise<SocialAccountResponse> {
        return await this.socialaccountModel.getSocialAccountList(page, size, search, platform);
    }

    //save social account to local database
    public async saveSocialAccount(
        soc: SocialAccountDetailData
    ): Promise<SavesocialaccountResp> {
        return await this.socialaccountModel.saveSocialAccount(soc);
    }
}
