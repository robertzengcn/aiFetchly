import { windowInvoke } from "@/views/utils/apirequest";
import { SearchResult } from "@/views/api/types";
import {
  EMAIL_RECEIVE_SYNC,
  EMAIL_RECEIVE_CONNECTION_TEST,
  EMAIL_RECEIVE_MESSAGE_LIST,
  EMAIL_RECEIVE_MESSAGE_DETAIL,
  EMAIL_REPLY_MARK_PROCESSED,
} from "@/config/channellist";
import type {
  ReceivedMessageListDto,
  ReceivedMessageDetailDto,
} from "@/entityTypes/emailReceiveTypes";
import type { EmailServiceReceiveSummary } from "@/entityTypes/emailmarketingType";

/** Sync (fetch) unread/recent messages for a receive-enabled service. */
export async function syncUnreadEmails(input: {
  emailServiceId: number;
  limit?: number;
  unreadOnly?: boolean;
  since?: string;
}): Promise<{ emailServiceId: number; fetched: number; stored: number; messageIds: number[] }> {
  return await windowInvoke(EMAIL_RECEIVE_SYNC, input);
}

/** Test receive connectivity. Does not mutate stored sync state. */
export async function testEmailReceiveConnection(
  emailServiceId: number,
  settings?: {
    protocol: string;
    host: string;
    port: number;
    ssl: boolean;
    username: string;
    password?: string;
    folder: string;
  }
): Promise<{ success: boolean; error: string | null }> {
  return await windowInvoke(EMAIL_RECEIVE_CONNECTION_TEST, { emailServiceId, settings });
}

export interface ReceivedMessageListInput {
  emailServiceId: number;
  page: number;
  size: number;
  where?: string;
  search?: string;
  sortby?: { key: string; order: string };
  unreadOnly?: boolean;
  replyStatus?: string;
  classification?: string;
}

export async function listReceivedMessages(
  input: ReceivedMessageListInput
): Promise<SearchResult<ReceivedMessageListDto>> {
  const resp = await windowInvoke(EMAIL_RECEIVE_MESSAGE_LIST, input);
  return { data: resp.records, total: resp.num };
}

export async function getReceivedMessage(
  id: number,
  includeBody = true
): Promise<ReceivedMessageDetailDto> {
  return await windowInvoke(EMAIL_RECEIVE_MESSAGE_DETAIL, { id, includeBody });
}

export async function markEmailProcessed(input: {
  messageId: number;
  status: "skipped" | "blocked" | "failed" | "needs_human_review";
  reason?: string;
}): Promise<{ messageId: number; status: string }> {
  return await windowInvoke(EMAIL_REPLY_MARK_PROCESSED, input);
}

/** Re-export the summary type for the inbox picker UI. */
export type { EmailServiceReceiveSummary };
