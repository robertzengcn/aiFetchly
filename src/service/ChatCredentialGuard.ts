/**
 * ChatCredentialGuard — FR-31 / NFR-03 (PRD §19.1–§19.2, audit finding 8):
 * a pasted credential must be rejected at the ORDINARY CHAT persistence
 * boundary, before the message is saved to the conversation transcript.
 *
 * The installer tool schemas already reject secret-shaped arguments, but
 * that gate sits on a separate path: a user pasting an API key into the
 * composer reached `AIChatQueryEngine.submitMessage` →
 * `AIChatV2Module.saveUserMessage` → `AIChatModule.saveMessage` unchanged.
 * This module is the single, transport-agnostic check the engine applies
 * BEFORE any persistence or provider call.
 *
 * Detection reuses the installer's secret-value shapes (sk-…, gh[pousr]_…,
 * PEM private keys, JWTs) so the two boundaries agree on what "credential
 * shaped" means. Plain conversation about keys ("what is an API key") is
 * unaffected — only concrete value shapes match.
 */

import { SECRET_VALUE_RE } from "@/entityTypes/skillInstallationTypes";

export interface ChatCredentialGuardResult {
  /** True when the message contains a concrete credential-shaped value. */
  readonly rejected: boolean;
  /** Stable code for the renderer's localized guidance. */
  readonly errorCode: "CHAT_CREDENTIAL_REJECTED";
  /** Safe, non-secret detail for logs and the error envelope. */
  readonly message: string;
}

/**
 * Scan a chat message for credential-shaped values. The match itself is
 * never included in the result — only a fixed, safe message.
 */
export function checkChatMessageForCredentials(
  message: string
): ChatCredentialGuardResult {
  if (typeof message !== "string" || message.length === 0) {
    return { rejected: false, errorCode: "CHAT_CREDENTIAL_REJECTED", message: "" };
  }
  if (SECRET_VALUE_RE.test(message)) {
    return {
      rejected: true,
      errorCode: "CHAT_CREDENTIAL_REJECTED",
      message:
        "This message looks like it contains an API key or secret. " +
        "Credentials are rejected in chat — use the secure input on the " +
        "installation card instead.",
    };
  }
  return { rejected: false, errorCode: "CHAT_CREDENTIAL_REJECTED", message: "" };
}
