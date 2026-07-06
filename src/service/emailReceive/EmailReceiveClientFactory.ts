import { EmailReceiveProtocol } from "@/entityTypes/emailReceiveTypes";
import { EmailReceiveClient } from "@/service/emailReceive/EmailReceiveClient";
import { ImapEmailReceiveClient } from "@/service/emailReceive/ImapEmailReceiveClient";
import { Pop3EmailReceiveClient } from "@/service/emailReceive/Pop3EmailReceiveClient";

/**
 * Resolve a receive client for a protocol. IMAP is the default and the only
 * fully-supported protocol in the MVP; POP3 returns a stub that surfaces a
 * clear error if selected.
 */
export class EmailReceiveClientFactory {
  static createClient(protocol: EmailReceiveProtocol): EmailReceiveClient {
    if (protocol === "pop3") {
      return new Pop3EmailReceiveClient();
    }
    return new ImapEmailReceiveClient();
  }
}
