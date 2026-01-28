// import * as path from "path"
// import * as fs from "fs"
import Papa from 'papaparse';
import fetch from 'node-fetch';
// import { fetch as undicifetch,Agent } from "undici";
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyParseItem, ProxyCheckres, ProxylistResp } from "@/entityTypes/proxyType"
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
// import { socksDispatcher } from "fetch-socks";
import { ProxyCheckModel, proxyCheckStatus, googlePassStatus } from "@/model/ProxyCheck.model";
import { Token } from "@/modules/token"
import { USERSDBPATH } from '@/config/usersetting';
//import { ProxyApi } from "@/api/proxyApi"
import { SocksProxyAgent } from 'socks-proxy-agent';
// import { Request, Response } from "express";
// import { ProxyModel } from "@/model/Proxy.model";
// import { getRecorddatetime } from "@/modules/lib/function";
// import { ProxyEntity } from "@/entity/Proxy.entity";
import { ProxyCheckEntity } from "@/entity/ProxyCheck.entity";
import {IProxyApi} from "@/modules/interface/IProxyApi"
import {ProxyModule} from "@/modules/ProxyModule"
import { utilityProcess } from 'electron';
import * as path from 'path';
export class ProxyController {
    //import proxy from csv file
    // public async importProxyfile(filename: string) {
    //     //check filename is csv and exist
    //     if (!(path.extname(filename) === '.csv')) {
    //         throw new Error('File is not a csv');
    //     }
    //     fs.access(filename, fs.constants.F_OK, async (err) => {
    //         if (err) {
    //             throw new Error('File does not exist');
    //         } else {

    //         }
    //     });
    private proxyCheckdb: ProxyCheckModel
    private proxyapi: IProxyApi
    constructor() {
        const tokenService = new Token()
        let dbpath = tokenService.getValue(USERSDBPATH)
        if (!dbpath) {
            // For testing environments, use a temp directory
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const os = require('os') as typeof import('os');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const path = require('path') as typeof import('path');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('fs') as typeof import('fs');
            const tmpDir = path.join(os.tmpdir(), 'aifetchly-test');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            dbpath = tmpDir;
        }

        this.proxyCheckdb = new ProxyCheckModel(dbpath)
        this.proxyapi = new ProxyModule()
    }
    //     //return proxy list
    //     const response = await fetch(filename);
    //     return response;
    // }
    //handle csv file
    public async handleCsvdata(filename: string) {
        const response = await fetch(filename);
        const csvData = await response.text();
        const results = Papa.parse(csvData, { header: true });
        return results.data;
    }
    //convert proxy entity to url

    // Helper method to check HTTP proxy using CONNECT method
    private async checkHttpProxy(proxyHost: string, proxyPort: string, username?: string, password?: string, testUrl = 'https://httpbin.org/ip', timeout = 5000): Promise<boolean> {
        return new Promise((resolve) => {
            const options: any = {
                host: proxyHost,
                port: parseInt(proxyPort),
                method: 'CONNECT',
                path: new URL(testUrl).host + ':443',
                timeout,
            };

            // Add authentication if provided
            if (username && password) {
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                options.headers = {
                    'Proxy-Authorization': `Basic ${auth}`
                };
            }

            const req = http.request(options);
            req.on('connect', (res, socket) => {
                socket.end();
                resolve(res.statusCode === 200);
            });

            req.on('error', (error) => {
                console.log(`HTTP proxy error: ${error.message}`);
                resolve(false);
            });
            
            req.on('timeout', () => {
                console.log(`HTTP proxy timeout after ${timeout}ms`);
                req.destroy();
                resolve(false);
            });

            req.end();
        });
    }

    // Helper method to check SOCKS proxy
    private async checkSocksProxy(proxyHost: string, proxyPort: string, username?: string, password?: string, testUrl = 'https://httpbin.org/ip', timeout = 5000): Promise<boolean> {
        return new Promise((resolve) => {
            const options: any = {
                host: proxyHost,
                port: parseInt(proxyPort),
                method: 'CONNECT',
                path: new URL(testUrl).host + ':443',
                timeout,
            };

            // Add authentication if provided
            if (username && password) {
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                options.headers = {
                    'Proxy-Authorization': `Basic ${auth}`
                };
            }

            const req = http.request(options);
            req.on('connect', (res, socket) => {
                socket.end();
                resolve(res.statusCode === 200);
            });

            req.on('error', (error) => {
                console.log(`SOCKS proxy error: ${error.message}`);
                resolve(false);
            });
            
            req.on('timeout', () => {
                console.log(`SOCKS proxy timeout after ${timeout}ms`);
                req.destroy();
                resolve(false);
            });

            req.end();
        });
    }

    //check proxy valid
    public async checkProxy(proxyEntity: ProxyParseItem, timeout = 5000): Promise<ProxyCheckres> {
        try {
            if (!proxyEntity.protocol) {
                throw new Error("protocol is required");
            }

            let isValid = false;

            if (proxyEntity.protocol.includes('http')) {
                // For HTTP/HTTPS proxies, use CONNECT method
                console.log(`Checking HTTP proxy: ${proxyEntity.host}:${proxyEntity.port}`);
                isValid = await this.checkHttpProxy(
                    proxyEntity.host, 
                    proxyEntity.port, 
                    proxyEntity.user, 
                    proxyEntity.pass, 
                    'https://httpbin.org/ip', 
                    timeout
                );
            } else if (proxyEntity.protocol.includes('socks')) {
                // For SOCKS proxies, use CONNECT method
                console.log(`Checking SOCKS proxy: ${proxyEntity.host}:${proxyEntity.port}`);
                isValid = await this.checkSocksProxy(
                    proxyEntity.host, 
                    proxyEntity.port, 
                    proxyEntity.user, 
                    proxyEntity.pass, 
                    'https://httpbin.org/ip', 
                    timeout
                );
            } else {
                throw new Error("protocol is not valid");
            }

            if (isValid) {
                console.log(`Proxy ${proxyEntity.host}:${proxyEntity.port} is valid`);
                return { status: true, msg: "", data: true };
            } else {
                console.log(`Proxy ${proxyEntity.host}:${proxyEntity.port} is invalid`);
                return { status: false, msg: "proxy check failure", data: false };
            }
        } catch (error) {
            let message = "";
            if (error instanceof Error) {
                message = error.message;
            }
            console.log(`Proxy check error: ${message}`);
            throw new Error('Proxy is not valid, ' + message);
        }
    }

    /**
     * Check if proxy can pass Google's bot detection using child process
     * @param proxyEntity Proxy details to check
     * @param timeout Timeout in milliseconds (default: 15000)
     * @returns Promise<boolean> true if proxy passes Google check, false otherwise
     */
    public async checkGooglePass(proxyEntity: ProxyParseItem, timeout = 15000): Promise<boolean> {
        return new Promise((resolve, reject) => {
            // Resolve child process path
            const childPath = path.join(__dirname, '../childprocess/googleProxyCheck.js');
            const requestId = `google-check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            const child = utilityProcess.fork(childPath, [], {
                stdio: 'pipe',
                execArgv: [],
                env: { ...process.env, NODE_OPTIONS: '' }
            });
            
            // Set timeout to kill child process if it hangs
            const timeoutId = setTimeout(() => {
                try {
                    child.kill();
                } catch (error) {
                    console.error('Error killing child process:', error);
                }
                reject(new Error('Google check timeout'));
            }, timeout + 5000); // Add buffer to timeout
            
            // Handle child process spawn
            child.on('spawn', () => {
                // Send message to child process
                child.postMessage(JSON.stringify({
                    type: 'CHECK_GOOGLE_PASS',
                    proxy: proxyEntity,
                    timeout,
                    requestId
                }));
            });
            
            // Handle messages from child process
            const messageHandler = (message: unknown) => {
                try {
                    const msg = message as { data: string };
                    const response = JSON.parse(msg.data);
                    if (response.type === 'CHECK_GOOGLE_PASS_RESULT' && response.requestId === requestId) {
                        clearTimeout(timeoutId);
                        child.removeListener('message', messageHandler);
                        try {
                            child.kill();
                        } catch (error) {
                            console.error('Error killing child process:', error);
                        }
                        if (response.success) {
                            resolve(response.passed);
                        } else {
                            reject(new Error(response.error || 'Google check failed'));
                        }
                    }
                } catch (error) {
                    clearTimeout(timeoutId);
                    try {
                        child.kill();
                    } catch (killError) {
                        console.error('Error killing child process:', killError);
                    }
                    reject(error);
                }
            };
            
            child.on('message', messageHandler as (message: unknown) => void);
            
            // Handle child process exit
            child.on('exit', (code) => {
                clearTimeout(timeoutId);
                if (code !== 0 && code !== null) {
                    reject(new Error(`Child process exited with code ${code}`));
                }
            });
            
            // Handle child process errors
            child.on('error', (error) => {
                clearTimeout(timeoutId);
                try {
                    child.kill();
                } catch (killError) {
                    console.error('Error killing child process:', killError);
                }
                reject(error);
            });
            
            // Capture stderr from child process for debugging
            child.stderr?.on('data', (data) => {
                console.error(`Child process stderr: ${data}`);
            });
            
            // Capture stdout from child process for debugging
            child.stdout?.on('data', (data) => {
                console.log(`Child process stdout: ${data}`);
            });
        });
    }

    //check user's proxy and update db
    public async updateProxyStatus(proxyEntity: ProxyParseItem, proxyID: number, timeout?: number): Promise<void> {
        console.log("updateProxyStatus")
        console.log(proxyEntity)
        await this.checkProxy(proxyEntity, timeout).then(async (res) => {
            if (res.status) {
                //update success status to db
                await this.proxyCheckdb.updateProxyCheck(proxyID, proxyCheckStatus.Success)
                
                // If basic check passes, also check Google pass (async, non-blocking)
                this.checkGooglePass(proxyEntity, timeout).then((googlePassed) => {
                    const googleStatus = googlePassed ? googlePassStatus.Pass : googlePassStatus.Fail;
                    this.proxyCheckdb.updateGooglePassStatus(proxyID, googleStatus).catch((error) => {
                        console.error(`Error updating Google pass status for proxy ${proxyID}:`, error);
                    });
                }).catch((error) => {
                    console.error(`Error checking Google pass for proxy ${proxyID}:`, error);
                    // Mark as fail if check fails
                    this.proxyCheckdb.updateGooglePassStatus(proxyID, googlePassStatus.Fail).catch((updateError) => {
                        console.error(`Error updating Google pass status for proxy ${proxyID}:`, updateError);
                    });
                });
            } else {
                //update failure status to db
                await this.proxyCheckdb.updateProxyCheck(proxyID, proxyCheckStatus.Failure)
            }
        }).catch(async (error) => {
            console.log(error)
            //update status to db
            await this.proxyCheckdb.updateProxyCheck(proxyID, proxyCheckStatus.Failure)
        })


    }
    public async checkAllproxy(callback?: (arg: number, totalNum: number) => void, finishcall?: () => void, timeout?: number, proxyIds?: number[]): Promise<void> {
        // If specific proxy IDs are provided, only check those
        if (proxyIds && proxyIds.length > 0) {
            const total = proxyIds.length;
            let checked = 0;
            
            for (const proxyId of proxyIds) {
                try {
                    // Get proxy details by ID
                    const proxyDetail = await this.proxyapi.getProxyDetail(proxyId);
                    if (proxyDetail.status && proxyDetail.data) {
                        const proxy = proxyDetail.data;
                        if (proxy.host && proxy.port && proxy.protocol) {
                            const element: ProxyParseItem = {
                                host: proxy.host,
                                port: proxy.port,
                                protocol: proxy.protocol,
                                user: proxy.user,
                                pass: proxy.pass
                            };
                            await this.updateProxyStatus(element, proxyId, timeout).catch((error) => {
                                console.log(error);
                            });
                        }
                    }
                } catch (error) {
                    console.log(`Error checking proxy ${proxyId}:`, error);
                }
                
                checked++;
                if (callback) {
                    callback(checked, total);
                }
            }
            
            if (finishcall) {
                finishcall();
            }
            return;
        }
        
        // Otherwise, check all proxies (original behavior)
        const proxyCount = await this.proxyapi.getProxycount()
        if (proxyCount > 0) {
            const size = 10
            //get all proxy
            for (let i = 0; i < proxyCount; i = i + size) {
                //check each proxy
                const res = await this.proxyapi.getProxylist(i, size, "")
                if (res.status) {
                    console.log(res)
                    if (res.data) {
                        res.data.records.forEach(async (item) => {
                            if (item.host && item.port && item.protocol) {
                                const element: ProxyParseItem = {
                                    host: item.host,
                                    port: item.port,
                                    protocol: item.protocol,
                                    user: item.username,
                                    pass: item.password
                                }
                                console.log(element)
                                await this.updateProxyStatus(element, item.id!, timeout).catch((error) => {
                                    console.log(error)

                                })

                            }
                        });


                    }
                }
                //})
                if (callback) {
                    callback(i, proxyCount)
                }

            }
            if (finishcall) {
                finishcall()
            }
        }
    }
    public async getProxylist(page: number, size: number, search: string): Promise<ProxylistResp> {
        const checkDb = this.proxyCheckdb
        const res = await this.proxyapi.getProxylist(page, size, search).then(async function (res) {
            if (res.status) {

                if (res.data) {
                    // const pcdb=this.proxyCheckdb
                    //loop data and get check status and check time
                    if (res.data.records) {
                        // res.data.records.map((item) => {

                        //     const checkInfo = pcdb.getProxyCheck(item.id)
                        //     item.status = checkInfo.status
                        //     item.checktime = checkInfo.check_time
                        // })
                        for (let i = 0; i < res.data.records.length; i++) {
                            if (res.data.records[i].id != undefined) {
                                const checkInfo = await checkDb.getProxyCheck(res.data.records[i].id!)
                                if (checkInfo) {
                                    res.data.records[i].status = checkInfo.status
                                    res.data.records[i].checktime = checkInfo.check_time
                                    res.data.records[i].googlePass = checkInfo.google_pass ?? undefined
                                    
                                    // Map to display name
                                    if (checkInfo.google_pass === googlePassStatus.Pass) {
                                        res.data.records[i].googlePassName = "Pass"
                                    } else if (checkInfo.google_pass === googlePassStatus.Fail) {
                                        res.data.records[i].googlePassName = "Fail"
                                    } else {
                                        res.data.records[i].googlePassName = "Not Checked"
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return res;
        })
        return res
    }
    //remove failure proxy
    public async removeFailureProxy(callback?: () => void): Promise<void> {
        //get all failure proxy
        const failureProxy = await this.proxyCheckdb.getProxyByStatus(proxyCheckStatus.Failure);
        if (failureProxy) {
            console.log(failureProxy)
            //    const proxycheckres=this.proxyCheckdb
            //remove all failure proxy
            failureProxy.map(async (item) => {

                const res = await this.proxyapi.deleteProxy(item.proxy_id);
                if (res.status) {
                    //delete from db
                    this.proxyCheckdb.deleteProxyCheck(item.proxy_id)
                }
            })
        }

        if (callback) {
            callback()
        }
    }


}