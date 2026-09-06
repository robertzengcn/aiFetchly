import { ItemSearchparam } from "@/entityTypes/commonType";
export type BuckEmailListType = {
  TaskId: number;
  Type: string;
  Status: string;
  RecordTime?: string;
};
export interface BuckEmailTasklogQueryType extends ItemSearchparam {
  TaskId: number;
}

export interface EmailMarketingSendLogListDisplay {
  id: number;
  status: string;
  receiver: string;
  title: string;
  // content: string;
  record_time?: string;
}

/**
 * One row in the unified send-log view — aggregates legacy bulk-task sends
 * (emailmarketing_send_log) with authorized outbound sends
 * (outbound_email_delivery_outcome). `source` distinguishes the two halves so
 * the UI can badge them and the user can tell an AI-authorized send from a
 * bulk-task send.
 *
 * `id` is the row id within its source table (not globally unique); the
 * (source, id) pair is the stable identity. Optional fields are populated only
 * on the half that owns them (taskId on legacy, batchId/draftId on authorized).
 */
export interface UnifiedSendLogEntry {
  id: number;
  source: "legacy" | "authorized";
  status: string;
  receiver: string;
  title: string;
  record_time?: string;
  taskId?: number;
  batchId?: number;
  draftId?: number;
}
export interface EmailMarketingSendLogDetailDisplay {
  id: number;
  status: string;
  receiver: string;
  title: string;
  content: string;
  record_time?: string;
}
