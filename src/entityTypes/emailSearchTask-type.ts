import { EmailExtractionTypes } from "@/config/emailextraction";

/**
 * Relocated from the legacy raw-SQL `emailsearchTaskdb.ts` (WS-3 R3.2) so that
 * file + its Scraperdb dependency can be deleted. The TypeORM @Entity is
 * `EmailSearchTaskEntity` (capital S, in src/entity/); this interface is the
 * task-creation DTO used by EmailSearchTaskModule.
 */
export interface EmailsearchTaskEntity {
  id?: number;
  search_result_id?: number;
  error_log?: string;
  runtime_log?: string;
  record_time?: string;
  type_id: EmailExtractionTypes;
  status: EmailsearchTaskStatus;
  processTimeout: number;
  maxPageNumber: number;
  page_length: number;
  concurrency: number;
  is_active: boolean;
  notShowBrowser?: boolean;
  aiSupportEnabled?: boolean;
  createdAt?: Date;
}

export enum EmailsearchTaskStatus {
  Processing = 1,
  Complete = 2,
  Error = 3,
}
