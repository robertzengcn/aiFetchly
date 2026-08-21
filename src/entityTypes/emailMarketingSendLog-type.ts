import { SendStatus } from "@/model/emailMarketingSendLog.model";

/**
 * Relocated from the legacy raw-SQL `emailMarketingSendLogdb.ts` (WS-3 R3.2) so
 * that file + its Scraperdb dependency can be deleted. `SendStatus` already
 * lives in the TypeORM model (`EmailmarketingSendLog.model`).
 */
export interface EmailMarketingSendLogEntity {
  id?: number;
  status: SendStatus;
  task_id: number;
  receiver: string;
  title: string;
  content: string;
  record_time?: string;
  log?: string;
}
