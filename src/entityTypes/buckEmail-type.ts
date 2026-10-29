import { TaskStatus } from "@/entityTypes/commonType";

/**
 * Relocated from the legacy raw-SQL `buckEmailTaskdb.ts` (WS-3 R3.2) so that
 * file + its Scraperdb dependency can be deleted.
 */
export enum BuckEmailType {
  EXTRACTEMAIL = 1,
}

export interface BuckemailEntity {
  id?: number;
  type: BuckEmailType;
  emailtaskentityId?: number;
  email_list_json?: string | null;
  notduplicate?: number;
  record_time?: string;
  log_file: string;
  error_file: string;
  status?: TaskStatus;
}
