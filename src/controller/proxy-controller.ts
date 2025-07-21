// import * as path from "path"
// import * as fs from "fs"
import Papa from 'papaparse';
import fetch from 'node-fetch';
// import { fetch as undicifetch,Agent } from "undici";
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyParseItem, ProxyCheckres, ProxylistResp } from "@/entityTypes/proxyType"
// import * as url from 'url';
// import { socksDispatcher } from "fetch-socks";
import { ProxyCheckModel, proxyCheckStatus } from "@/model/ProxyCheck.model";
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
        const dbpath = tokenService.getValue(USERSDBPATH)
        if (!dbpath) {
            throw new Error("user path not exist")
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

    //check proxy valid
    public async checkProxy(proxyEntity: ProxyParseItem,timeout=5000): Promise<ProxyCheckres> {
        try {

            let proxyUrl = "";
            if (!proxyEntity.protocol) {
                throw new Error("protocol is required");
            }

            if (proxyEntity.protocol.includes('http')) {
                if ((proxyEntity.user && (proxyEntity.user?.length > 0)) && (proxyEntity.pass && (proxyEntity.pass?.length > 0))) {
                    proxyUrl = `${proxyEntity.protocol}://${proxyEntity.user}:${proxyEntity.pass}@${proxyEntity.host}:${proxyEntity.port}`;
                } else {
                    proxyUrl = `${proxyEntity.protocol}://${proxyEntity.host}:${proxyEntity.port}`;
                }
                console.log(proxyUrl)
                const agent = new HttpsProxyAgent(proxyUrl);
                const res = await fetch('https://ident.me/ip', { agent: agent, signal: AbortSignal.timeout(timeout), });

                if (res.status == 200) {
                    console.log(res.status);
                    return { status: true, msg: "", data: true };
                }
                console.log("status is" + res.status.toString());
                return { status: false, msg: "proxy check failure, status code" + res.status.toString(), data: false };
                // console.log('Proxy is valid');
            } else if (proxyEntity.protocol.includes('socks')) {
                let socketType: 4 | 5 = 5
                if (proxyEntity.protocol.includes('4')) {
                    socketType = 4
                }
                if ((proxyEntity.user && (proxyEntity.user?.length > 0)) && (proxyEntity.pass && (proxyEntity.pass?.length > 0))) {
                    proxyUrl = `${proxyEntity.protocol}+${socketType}://${proxyEntity.user}:${proxyEntity.pass}@${proxyEntity.host}:${proxyEntity.port}`;
                } else {
                    proxyUrl = `${proxyEntity.protocol}+${socketType}://${proxyEntity.host}:${proxyEntity.port}`;
                }
                // console.log(proxyEntity.host)
                // console.log(proxyEntity.port)
                // const dispatcher = socksDispatcher({
                //     type: socketType,
                //     host: proxyEntity.host,
                //     port: parseInt(proxyEntity.port),
                //     userId: proxyEntity.user,
                //     password: proxyEntity.pass,
                // });
                const agent = new SocksProxyAgent(proxyUrl);
                // const res = await undicifetch("https://ident.me/ip", { dispatcher });
                const res =await fetch("https://ident.me/ip", { agent })
                if (res.status == 200) {
                    console.log(res.status);
                    return { status: true, msg: "", data: true };
                }
                console.log("status is" + res.status.toString());
                return { status: false, msg: "proxy check failure, status code" + res.status.toString(), data: false };
            } else {
                throw new Error("protocol is not valid");
            }
        } catch (error) {
            // console.log('Proxy is not valid');
            let message = ""
            if (error instanceof Error) {
                message = error.message
            }
            throw new Error('Proxy is not valid,' + message);
        }
    }
    //check user's proxy and update db
    public async updateProxyStatus(proxyEntity: ProxyParseItem, proxyID: number): Promise<void> {
        console.log("updateProxyStatus")
        console.log(proxyEntity)
        await this.checkProxy(proxyEntity).then((res) => {
            if (res.status) {
                //update success status to db
                this.proxyCheckdb.updateProxyCheck(proxyID, proxyCheckStatus.Success)
            } else {
                //update failure status to db
                this.proxyCheckdb.updateProxyCheck(proxyID, proxyCheckStatus.Failure)
            }
        }).catch((error) => {
            console.log(error)
            //update status to db
            this.proxyCheckdb.updateProxyCheck(proxyID, proxyCheckStatus.Failure)
        })


    }
    public async checkAllproxy(callback?: (arg: number, totalNum: number) => void, finishcall?: () => void): Promise<void> {
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
                                await this.updateProxyStatus(element, item.id!).catch((error) => {
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