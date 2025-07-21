// import { Database } from 'better-sqlite3';
// import { Scraperdb } from "@/model/scraperdb";
// import { SortBy } from "@/entityTypes/commonType"

// export interface EmailFilterEntity {
//     id?: number;
//     name: string;
//     // content: string;
//     description: string | null;
//     status?: number;
//     createdAt?: Date;
//     updatedAt?: Date;
// }

// export class EmailFilterTaskdb {
//     db: Database;
//     emailFilterTable = "email_filter";
    
//     constructor(filepath: string) {
//         const scraperModel = Scraperdb.getInstance(filepath);
//         //this.db = scraperModel.getdb();
//     }
    
//     create(filter: EmailFilterEntity): number {
//         const stmt = this.db.prepare(`
//             INSERT INTO ${this.emailFilterTable} (name, content, description, status)
//             VALUES (@name, @content, @description, @status)
//         `);
//         const info = stmt.run({
//             name: filter.name,
//             // content: filter.content,
//             description: filter.description,
//             status: filter.status || 1
//         });
//         return info.lastInsertRowid as number;
//     }

//     read(id: number): EmailFilterEntity | undefined {
//         const stmt = this.db.prepare(`
//             SELECT * FROM ${this.emailFilterTable} WHERE id = ?
//         `);
//         return stmt.get(id) as EmailFilterEntity | undefined;
//     }

//     update(id: number, filter: EmailFilterEntity): void {
//         const stmt = this.db.prepare(`
//             UPDATE ${this.emailFilterTable}
//             SET name = @name, content = @content, description = @description, status = @status
//             WHERE id = @id
//         `);
//         stmt.run({
//             id: id,
//             name: filter.name,
//             content: filter.content,
//             description: filter.description,
//             status: filter.status || 1
//         });
//     }

//     delete(id: number): void {
//         const stmt = this.db.prepare(`
//             DELETE FROM ${this.emailFilterTable} WHERE id = ?
//         `);
//         stmt.run(id);
//     }

//     updateFilterStatus(id: number, status: number): void {
//         const stmt = this.db.prepare(`
//             UPDATE ${this.emailFilterTable}
//             SET status = @status
//             WHERE id = @id
//         `);
//         stmt.run({
//             id: id,
//             status: status
//         });
//     }

//     listEmailFilters(page: number, size: number, sort?: SortBy): Array<EmailFilterEntity> {
//         let query = 'SELECT * FROM ' + this.emailFilterTable;

//         if (sort && sort.key && sort.order) {
//             const lowsersortkey = sort.key.toLowerCase();
//             const lowsersortorder = sort.order.toLowerCase();
//             const allowsortkey = ['id', 'name', 'status', 'createdAt'];
//             const allowsortorder = ['asc', 'desc'];

//             if (!allowsortkey.includes(lowsersortkey)) {
//                 throw new Error("not allow sort key");
//             } else {
//                 if (!allowsortorder.includes(lowsersortorder)) {
//                     throw new Error("not allow sort order");
//                 }
//                 query += ' ORDER BY ' + lowsersortkey + ' ' + lowsersortorder;
//             }
//         } else {
//             query += ' ORDER BY id DESC';
//         }
        
//         query += ' LIMIT ? OFFSET ?';
//         const stmt = this.db.prepare(query);

//         return stmt.all(size, page) as EmailFilterEntity[];
//     }

//     countEmailFilters(): number {
//         const stmt = this.db.prepare(`
//             SELECT COUNT(*) as count FROM ${this.emailFilterTable}
//         `);
//         const totalobj = stmt.get() as { count: number };
//         return totalobj.count;
//     }
// } 