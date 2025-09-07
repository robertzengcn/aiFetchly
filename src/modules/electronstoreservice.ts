// const keytar = require('keytar')
// import keytar from 'keytar'

import Store  from "electron-store"
import { app } from 'electron'

export class ElectronStoreService {
    private store:Store;
    // private service:string;
    constructor(service:string){
        // Get app name and combine with service name
        const appName = app.getName();
        const serviceName = `${appName}:${service}`;
        this.store = new Store({name: serviceName});
    }
    public setValue(key, value:string){
        this.store.set(key,value);
    } 
    //get password
    public getValue(key:string){
       return this.store.get(key);
    }

    public deleteValue(key: string): void {
        this.store.delete(key);
    }

    public clearStore(): void {
        this.store.clear();
    }

}