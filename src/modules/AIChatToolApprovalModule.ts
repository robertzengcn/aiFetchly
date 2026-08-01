import { Token } from "@/modules/token";
import type { ChatToolApprovalMode } from "@/entityTypes/aiChatV2Types";

const TOOL_APPROVAL_MODE_PREFIX = "AI_CHAT_V2_TOOL_APPROVAL_MODE_";
const DEFAULT_MODE: ChatToolApprovalMode = "ask_for_approval";

function tokenKey(conversationId: string): string {
  return `${TOOL_APPROVAL_MODE_PREFIX}${conversationId}`;
}

export class AIChatToolApprovalModule {
  private token: Token;

  /**
   * Tracks whether the startup-reset has already been applied in this
   * process. When true, full_access reads pass through as-is.
   */
  private static startupResetApplied = false;

  /**
   * Set to true whenever setMode("full_access") is called in this
   * process. The startup reset in getMode() checks this flag: if the
   * user explicitly re-selected "Full access" in the current session,
   * we do NOT downgrade it. This preserves the security guarantee that
   * full_access does not survive across app restarts while allowing
   * the user to enable it within a session.
   */
  private static fullAccessExplicitlySet = false;

  constructor() {
    this.token = new Token();
  }

  getMode(conversationId: string): ChatToolApprovalMode {
    if (!conversationId) return DEFAULT_MODE;
    const raw = this.token.getValue(tokenKey(conversationId));
    if (raw === "approve_for_me") {
      return raw;
    }
    if (raw === "full_access") {
      // Downgrade full_access on first read after app startup (PRD §4.3),
      // but ONLY if the user has NOT explicitly re-selected it in this
      // session. This prevents the reset from firing on tool-execution
      // reads right after the user set "Full access".
      if (
        !AIChatToolApprovalModule.startupResetApplied &&
        !AIChatToolApprovalModule.fullAccessExplicitlySet
      ) {
        AIChatToolApprovalModule.startupResetApplied = true;
        this.setMode(conversationId, "ask_for_approval");
        return "ask_for_approval";
      }
      return raw;
    }
    return DEFAULT_MODE;
  }

  setMode(conversationId: string, mode: ChatToolApprovalMode): void {
    if (!conversationId) return;
    if (mode === "full_access") {
      AIChatToolApprovalModule.fullAccessExplicitlySet = true;
    }
    this.token.setValue(tokenKey(conversationId), mode);
  }
}
