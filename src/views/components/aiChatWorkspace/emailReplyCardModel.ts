import type { ChatV2MessageView } from '@/entityTypes/aiChatV2Types';
import { MessageType } from '@/entityTypes/commonType';

/** Only successful reply tool results may expose a persisted review card. */
export function emailReplyDraftId(message: ChatV2MessageView): number | null {
  if (message.messageType !== MessageType.TOOL_RESULT) return null;
  const name = message.metadata?.toolName;
  if (name !== 'create_email_reply_draft' && name !== 'send_email_reply') return null;
  const result = message.metadata?.toolResult;
  if (!result || result.success === false || message.metadata?.error) return null;
  const id = name === 'send_email_reply' ? result.draft_id : result.draftId;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}
