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

/**
 * D8.3 (security): strip control characters from a header value (subject).
 * Control chars (NUL, BEL, CR, LF, other C0 controls) break log lines,
 * storage, and downstream rendering, and are a known log-injection vector.
 * Collapses embedded CR/LF runs to a single space; strips other control
 * chars; preserves printable ASCII + tab. Applies the model's 998-char
 * subject cap. Shared by both POP3 and IMAP receive clients.
 */
export function sanitizeHeaderValue(value: string): string {
  // The control-char class is intentional — this is the security filter that
  // removes log-injection / control-char vectors from header values.
  /* eslint-disable no-control-regex -- stripping control chars is the purpose */
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
    .slice(0, 998);
  /* eslint-enable no-control-regex */
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
 * High-confidence role tokens matched as a segment of the local-part
 * (`forms-receipts-noreply`). Not applied to the domain, display name, or
 * comment, so `person@noreply.example.com` and `techno-reply@` stay human.
 */
const AUTOMATED_LOCAL_SEGMENTS: ReadonlySet<string> = new Set([
  "no-reply",
  "noreply",
  "do-not-reply",
  "donotreply",
  "mailer-daemon",
  "mail-daemon",
  "postmaster",
  "auto-reply",
  "autoresponder",
]);

/**
 * Whole mailbox local-parts that are automated: every segment token above,
 * plus `mailer` / `notification(s)` / `automated` which stay whole-local-part
 * ONLY — as segments they would block human addresses like
 * `not-automated@` or `account-notifications@`. Compared after `+tag` is
 * stripped and again with `.` `_` `-` removed (`no.reply` → `noreply`).
 */
const AUTOMATED_LOCAL_PARTS: ReadonlySet<string> = new Set([
  ...AUTOMATED_LOCAL_SEGMENTS,
  "mailer",
  "notification",
  "notifications",
  "automated",
]);

const EMAIL_IN_HEADER_RE =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*/i;

/** Bare mailbox local-part, ignoring display name, comment, and `+tag`. */
function mailboxLocalPart(raw: string): string {
  const lower = raw.toLowerCase();
  const match = lower.match(EMAIL_IN_HEADER_RE);
  const email = match ? match[0] : lower.trim();
  const at = email.lastIndexOf("@");
  const local = (at >= 0 ? email.slice(0, at) : email).trim();
  const plus = local.indexOf("+");
  return plus >= 0 ? local.slice(0, plus) : local;
}

function localPartIsAutomated(local: string): boolean {
  if (local.length === 0) return false;
  const compact = local.replace(/[._-]/g, "");
  if (AUTOMATED_LOCAL_PARTS.has(local) || AUTOMATED_LOCAL_PARTS.has(compact)) {
    return true;
  }
  const segments = local.split(/[._-]+/).filter((segment) => segment.length > 0);
  return segments.some((segment) => AUTOMATED_LOCAL_SEGMENTS.has(segment));
}

/**
 * Detect whether a sender address or message headers indicate an automated
 * sender that must never receive an auto-reply (loop prevention, RFC 3834).
 * Address matching uses the mailbox local-part only.
 */
export function isAutomatedSender(args: {
  fromAddress: string;
  autoSubmitted?: string | null;
  precedence?: string | null;
}): boolean {
  if (localPartIsAutomated(mailboxLocalPart(args.fromAddress))) return true;

  const autoSubmitted = (args.autoSubmitted ?? "").toLowerCase().trim();
  if (autoSubmitted.length > 0 && autoSubmitted !== "no") return true;

  const precedence = (args.precedence ?? "").toLowerCase().trim();
  if (precedence === "bulk" || precedence === "junk" || precedence === "list") return true;

  return false;
}

/**
 * Address a reply would be sent to. Reply-To wins when the message has one;
 * otherwise the From mailbox. Display names are left intact for the caller.
 */
export function replyRecipientAddress(
  fromAddress: string,
  replyToAddress?: string | null
): string {
  const replyTo = replyToAddress?.trim() ?? "";
  if (replyTo.length > 0) return replyTo;
  return fromAddress ?? "";
}
