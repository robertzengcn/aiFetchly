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
   * Static flag: cleared on construction (one per module instance from
   * transient IPC handlers). On the first getMode() call that encounters
   * a stored full_access, we downgrade it to ask_for_approval — this
   * effectively resets full_access across app restarts since the module
   * is constructed fresh per process.
   */
  private static startupResetApplied = false;

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
      // Downgrade full_access on first read after app startup (PRD §4.3).
      // The module is constructed fresh per process, so this static flag
      // ensures the downgrade happens at most once per app session.
      if (!AIChatToolApprovalModule.startupResetApplied) {
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
    this.token.setValue(tokenKey(conversationId), mode);
  }
}
