import { TaskStatus } from "@/entityTypes/commonType";

/**
 * Relocated from the legacy raw-SQL `emailMarketingTaskdb.ts` (WS-3 R3.2) so
 * that file + its Scraperdb dependency can be deleted.
 */
export enum EmailMarketingTaskStatus {
  Processing = 1,
  Complete = 2,
  Error = 3,
}

export interface EmailMarketingTaskdbEntity {
  id?: number;
  status: TaskStatus;
  record_time?: string;
}
