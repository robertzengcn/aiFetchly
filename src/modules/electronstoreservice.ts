// const keytar = require('keytar')
// import keytar from 'keytar'

import Store  from "electron-store"
export class ElectronStoreService {
    private store:Store;
    // private service:string;
    constructor(service:string){
        this.store = new Store({name:service});
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