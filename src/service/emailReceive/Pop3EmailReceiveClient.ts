import {
  EmailReceiveConnectionConfig,
  EmailReceiveFetchOptions,
} from "@/entityTypes/emailReceiveTypes";
import {
  EmailReceiveClient,
  ParsedInboundEmail,
} from "@/service/emailReceive/EmailReceiveClient";

/**
 * POP3 receive client placeholder.
 *
 * POP3 has no folder semantics and no reliable unread state, so it requires a
 * different dedupe strategy (UIDL / message hash). It is intentionally not part
 * of the MVP; this stub honors the {@link EmailReceiveClient} contract so a
 * concrete implementation can replace it without touching callers.
 */
export class Pop3EmailReceiveClient implements EmailReceiveClient {
  async testConnection(_config: EmailReceiveConnectionConfig): Promise<void> {
    throw new Error("POP3 receive is not supported in the MVP. Use IMAP instead.");
  }

  async fetchMessages(
    _config: EmailReceiveConnectionConfig,
    _options: EmailReceiveFetchOptions
  ): Promise<ParsedInboundEmail[]> {
    throw new Error("POP3 receive is not supported in the MVP. Use IMAP instead.");
  }
}
