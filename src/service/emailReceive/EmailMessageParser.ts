/**
 * Pure helpers for normalizing parsed inbound email headers into the fields
 * stored on {@link EmailReceivedMessageEntity}. No I/O, no DB, no Electron.
 */

/** Build a stable thread key from References / In-Reply-To / Message-ID. */
export function extractThreadKey(
  messageId: string | null,
  inReplyTo: string | null,
  references: string | null
): string | null {
  const firstRef = (references ?? "").split(/\s+/).map((s) => s.trim()).filter(Boolean)[0];
  const key = firstRef || inReplyTo || messageId;
  return key ? key : null;
}

/** Build a short plain-text snippet (first ~280 chars, single-lined). */
export function buildSnippet(text: string | null, max = 280): string | null {
  if (!text) return null;
  const single = text.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max).trimEnd() + "…";
}

/** JSON-encode an address list, tolerating null/undefined. */
export function encodeAddresses(addresses: ReadonlyArray<string>): string {
  return JSON.stringify(addresses.slice());
}

/** Decode a JSON address list; returns [] on any error. */
export function decodeAddresses(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [];
  } catch {
    return [];
  }
}

/**
 * Detect whether a sender address or message headers indicate an automated
 * sender that must never receive an auto-reply (loop prevention, RFC 3834).
 */
export function isAutomatedSender(args: {
  fromAddress: string;
  autoSubmitted?: string | null;
  precedence?: string | null;
}): boolean {
  const addr = args.fromAddress.toLowerCase();
  const noReplyLocalParts = [
    "no-reply",
    "noreply",
    "do-not-reply",
    "donotreply",
    "mailer-daemon",
    "mail-daemon",
    "postmaster",
    "auto-reply",
    "autoresponder",
  ];
  if (noReplyLocalParts.some((p) => addr.includes(p))) return true;

  const autoSubmitted = (args.autoSubmitted ?? "").toLowerCase().trim();
  if (autoSubmitted.length > 0 && autoSubmitted !== "no") return true;

  const precedence = (args.precedence ?? "").toLowerCase().trim();
  if (precedence === "bulk" || precedence === "junk" || precedence === "list") return true;

  return false;
}
