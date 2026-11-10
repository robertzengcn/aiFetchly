import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";

export interface GeneratedImageReferenceView {
  reference: ChatV2GeneratedImageReference;
  thumbUrl?: string;
  fileName?: string;
}
