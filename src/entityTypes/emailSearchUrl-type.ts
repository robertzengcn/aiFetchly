/**
 * Email-search URL DTO (WS-3 R3.2): relocated from the legacy raw-SQL
 * `emailsearchUrldb.ts` so that file (and its Scraperdb dependency) can be
 * deleted. The TypeORM entity is `EmailSearchTaskUrlEntity`; this interface is
 * the minimal transfer shape used by EmailsearchTaskUrl.model + the module.
 */
export interface EmailsearchUrlEntity {
  id?: number;
  task_id: number;
  url: string;
}
