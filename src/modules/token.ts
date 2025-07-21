"use strict";
export { };
// const keytar = require('keytar')
// const os = require('os');
// import Store from 'electron-store';
//import { safeStorage } from 'electron';
import { CryptoSource } from '@/modules/cryptosource';
//import {StoreService} from "@/modules/storeservice"
import {USERSERVICE} from '@/config/usersetting';
import {ElectronStoreService} from "@/modules/electronstoreservice"

export class Token {

    // private keytarService = 'SocialScraper-token';
    private store: ElectronStoreService;
    private useSafestore: boolean;

    constructor() {
       const option = {
            encryptionKey: "social-market-key",//对配置文件进行加密
            clearInvalidConfig: true, // 发生 SyntaxError  则清空配置,
        }

        //this.store = new StoreService(USERSERVICE);
        this.store = new ElectronStoreService(USERSERVICE);
        // this.useSafestore=safeStorage?.isEncryptionAvailable();  
        this.useSafestore = false;
    }
    //get account name
    // private getaccountname():string{
    //     return os.userInfo().username;
    // }
    //save user token
    public setValue(key: string, token: string): void {
        // console.log("encrypt token "+token)
        // console.log(safeStorage)
        // if (this.useSafestore) {
        //     const buffer = safeStorage.encryptString(token);
        //     // this.store.set(key, buffer.toString());
        //     this.store.setValue(key, buffer.toString());
        // } else {
            //if system not support safe storage
            const cryptModel = new CryptoSource();
            const encrytoken = cryptModel.encrypt(token)
            this.store.setValue(key, JSON.stringify(encrytoken));
        // }
        // keytar.setPassword(this.keytarService, this.getaccountname(), token)
    }
    //get user token
    public getValue(key: string): string {
        // console.log("the key is"+key);
        // const token=await keytar.getPassword(this.keytarService, this.getaccountname())
        // const buffer = this.store.get(key) as string;
        const buffer =this.store.getValue(key) as string;
        if (!buffer) {
            return "";
        }
        // if (this.useSafestore) {
        //     return safeStorage.decryptString(Buffer.from(buffer))
        // } else {
            //if system not support safe storage
            const cryptModel = new CryptoSource();
            return cryptModel.decrypt(JSON.parse(buffer))
        //}
    }
    //check encryption is available
    // public checkEncryavaile(key: string): boolean {
    //     return safeStorage.isEncryptionAvailable()
    // }
}

