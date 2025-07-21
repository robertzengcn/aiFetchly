import { BaseDb } from "@/model/Basedb";
import { ExtraModuleEntity } from "@/entityTypes/extramoduleType";
import { getRecorddatetime } from "@/modules/lib/function";
export class ExtraModulesdb extends BaseDb {
    constructor(filepath:string) {
        super(filepath)
        // const scraperModel = Scraperdb.getInstance(filepath);
        // this.db = scraperModel.getdb();
    }
    private _table = "extra_modules";
    //create extra modeule
    create(extraModule: Omit<ExtraModuleEntity, 'id'>): number {
        const ext = this.getExtraModuleByName(extraModule.name);
        if (ext) {
            const updateExtraModule = {
                id: ext.id,
                name: extraModule.name,
                version: extraModule.version,
                record_time: getRecorddatetime()
            }
            this.update(ext.id, updateExtraModule);
            return ext.id;
        } else {
            const stmt = this.db.prepare('INSERT INTO ' + this._table + ' (name, version,record_time) VALUES (?, ?, ?)');
            const info = stmt.run(
                extraModule.name,
                extraModule.version,
                getRecorddatetime()
            );
            return Number(info.lastInsertRowid);
        }
    }
    //get item from extra module
    read(id: number): ExtraModuleEntity | null {
        const stmt = this.db.prepare('SELECT * FROM ' + this._table + ' WHERE id = ?');
        const res = stmt.get(id) as ExtraModuleEntity;
        return res;
    }
    //update extra module   
    update(id: number, extraModule: ExtraModuleEntity) {
        const stmt = this.db.prepare(`
        UPDATE ${this._table}
        SET name=@name,version=@version,record_time=@record_time
        WHERE id = @id
    `);
        const info = stmt.run({
            id: id,
            name: extraModule.name,
            version: extraModule.version,
            record_time: getRecorddatetime()
        })
        return info.changes;
    }
    //delete extra module
    delete(id: number): void {
        const stmt = this.db.prepare(
            `DELETE FROM ` + this._table + ` WHERE id = ?`);
        const res = stmt.run(id);
    }
    //get extra module by name
    getExtraModuleByName(name: string): ExtraModuleEntity | null {
        const stmt = this.db.prepare('SELECT * FROM ' + this._table + ' WHERE name = ?');
        const res = stmt.get(name) as ExtraModuleEntity;
        return res;
    }
    deletePackage(name: string): void {
        const stmt = this.db.prepare(
            `DELETE FROM ` + this._table + ` WHERE name = ?`);
        const res = stmt.run(name);
    }
}