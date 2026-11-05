import { simpleParser, type ParsedMail } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { SANITIZE_OPTIONS } from "@/service/emailReceive/EmailHtmlSanitizer";
import { htmlToText } from "@/service/emailReceive/EmailBodyNormalizationService";
import type {
  EmailForwardAttachmentManifestEntry,
  EmailForwardAttachmentSelection,
} from "@/entityTypes/emailOrganizationTypes";
import { EMAIL_ORGANIZATION_LIMITS, isValidAttachmentPartId } from "@/entityTypes/emailOrganizationTypes";
import type { EmailMailboxAdapter, FullSourceResult } from "@/service/emailOrganization/EmailMailboxAdapter";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import type { EmailOrganizationArtifactBackend } from "@/service/emailOrganization/EmailOrganizationArtifactStore";
import {
  EmailOrganizationActionError,
} from "@/service/emailOrganization/EmailOrganizationErrors";
import { hashBytes } from "@/service/emailOrganization/EmailForwardEnvelopeHasher";

/**
 * Forward materialization (technical design §9.1): fetch the complete raw
 * source, parse it, build the forward content (optional note, forwarded
 * header block, preserved body), and freeze an attachment manifest with
 * encrypted artifacts. Materialization never touches Seen/Answered flags
 * (adapter PEEK fetch) and never silently degrades content.
 */

export interface MaterializeForwardInput {
  /** R14: UI locale for the forwarded-message separator/labels (default en). */
  readonly locale?: string;
  readonly sourceMessageId: number;
  readonly location: {
    readonly folderPath: string;
    readonly uidValidity: string;
    readonly uid: string;
  };
  readonly receiveConfig: EmailReceiveConnectionConfig;
  readonly note: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bccRecipients: readonly string[];
  readonly subject: string;
  readonly attachmentSelection: EmailForwardAttachmentSelection;
  readonly composeDraftOnly?: boolean;
}

export interface MaterializedForward {
  readonly composedByteCount: number;
  readonly sourceFullSourceHash: string;
  readonly sourceLocationSnapshotJson: string;
  readonly bodyText: string;
  readonly bodyHtml: string;
  readonly bodyTextArtifactId: string;
  readonly bodyHtmlArtifactId: string;
  readonly bodyTextHash: string;
  readonly bodyHtmlHash: string;
  readonly attachments: readonly EmailForwardAttachmentManifestEntry[];
  readonly selectedAttachmentCount: number;
  readonly selectedAttachmentBytes: number;
  readonly validationFindings: readonly string[];
}

export const FORWARD_SEPARATOR = "---------- Forwarded message ----------";

/** R14: localized forwarded-message header labels (design §9.1 step 5). */
const FORWARD_LABELS: Record<string, { separator: string; from: string; date: string; subject: string; to: string }> = {
  en: { separator: "---------- Forwarded message ----------", from: "From", date: "Date", subject: "Subject", to: "To" },
  zh: { separator: "---------- 转发的邮件 ----------", from: "发件人", date: "日期", subject: "主题", to: "收件人" },
  es: { separator: "---------- Mensaje reenviado ----------", from: "De", date: "Fecha", subject: "Asunto", to: "Para" },
  fr: { separator: "---------- Message transféré ----------", from: "De", date: "Date", subject: "Objet", to: "À" },
  de: { separator: "---------- Weitergeleitete Nachricht ----------", from: "Von", date: "Datum", subject: "Betreff", to: "An" },
  ja: { separator: "---------- 転送メッセージ ----------", from: "差出人", date: "日付", subject: "件名", to: "宛先" },
};

export function forwardLabelsForLocale(locale: string): {
  separator: string; from: string; date: string; subject: string; to: string;
} {
  return FORWARD_LABELS[locale.slice(0, 2).toLowerCase()] ?? FORWARD_LABELS.en;
}

interface RawAttachment {
  readonly partId: string;
  readonly displayName: string;
  readonly contentType: string | null;
  readonly content: Buffer;
  readonly cid: string | null;
  readonly disposition: "attachment" | "inline";
}

export class EmailForwardMaterializer {
  private readonly adapter: EmailMailboxAdapter;
  private readonly artifactStore: EmailOrganizationArtifactBackend;

  constructor(options: {
    adapter: EmailMailboxAdapter;
    artifactStore: EmailOrganizationArtifactBackend;
  }) {
    this.adapter = options.adapter;
    this.artifactStore = options.artifactStore;
  }

  async materialize(input: MaterializeForwardInput): Promise<MaterializedForward> {
    const fetchResult: FullSourceResult = await this.adapter.fetchFullSource(
      input.receiveConfig,
      input.location
    );
    if (fetchResult.status === "uid_validity_changed") {
      throw new EmailOrganizationActionError(
        "UID_VALIDITY_CHANGED",
        "The folder's UID validity changed; re-select the message.",
        false
      );
    }
    if (fetchResult.status === "source_missing") {
      throw new EmailOrganizationActionError(
        "SOURCE_NOT_FOUND",
        "The message is no longer at its verified location.",
        false
      );
    }
    if (fetchResult.status === "failed") {
      throw new EmailOrganizationActionError(
        fetchResult.reasonCode === "SOURCE_FETCH_FAILED" ? "SOURCE_FETCH_FAILED" : "NETWORK_BEFORE_DISPATCH",
        fetchResult.sanitizedError,
        fetchResult.reasonCode === "NETWORK_BEFORE_DISPATCH"
      );
    }

    const source = fetchResult.source;
    if (source.length > EMAIL_ORGANIZATION_LIMITS.maxSourceBytes) {
      throw new EmailOrganizationActionError(
        "SOURCE_TOO_LARGE",
        `Source exceeds the ${Math.floor(EMAIL_ORGANIZATION_LIMITS.maxSourceBytes / (1024 * 1024))} MiB limit.`,
        false
      );
    }
    const sourceFullSourceHash = hashBytes(source);

    const parsed = await simpleParser(source);
    assertSupportedMime(parsed);

    const rawAttachments = extractAttachments(parsed);

    // ---- Attachments (regular + inline CID assets), sanitized manifest ----
    // R02: the outgoing count/byte limits apply to the SELECTED parts, not
    // the whole source — a text-only or small-subset forward of a message
    // with many/large excluded attachments stays valid (the raw source has
    // its own independent bound above).
    const selectedPartIds = input.attachmentSelection.mode === "parts"
      ? new Set(input.attachmentSelection.partIds)
      : null;
    if (selectedPartIds !== null) {
      for (const partId of selectedPartIds) {
        if (!isValidAttachmentPartId(partId)) {
          throw new EmailOrganizationActionError(
            "VALIDATION_FAILED",
            "Invalid attachment part reference.",
            false
          );
        }
        // Every approved part ID must resolve against the fresh source: a
        // missing/changed part refuses instead of silently disappearing.
        if (!rawAttachments.some((attachment) => attachment.partId === partId)) {
          throw new EmailOrganizationActionError(
            "ATTACHMENT_UNAVAILABLE",
            `Selected attachment part ${partId} does not exist in the current source; refresh the draft.`,
            false
          );
        }
      }
    }

    const selectedForLimits = rawAttachments.filter(
      (attachment) =>
        input.attachmentSelection.mode === "all" ||
        (selectedPartIds !== null && selectedPartIds.has(attachment.partId))
    );
    if (selectedForLimits.length > EMAIL_ORGANIZATION_LIMITS.maxAttachments) {
      throw new EmailOrganizationActionError(
        "TOO_MANY_ATTACHMENTS",
        `Selection carries ${selectedForLimits.length} attachments; the limit is ${EMAIL_ORGANIZATION_LIMITS.maxAttachments}.`,
        false
      );
    }
    const selectedBytes = selectedForLimits.reduce((sum, att) => sum + att.content.length, 0);
    if (selectedBytes > EMAIL_ORGANIZATION_LIMITS.maxTotalAttachmentBytes) {
      throw new EmailOrganizationActionError(
        "ATTACHMENT_TOO_LARGE",
        "Selected attachments exceed the 15 MiB decoded limit.",
        false
      );
    }

    const manifest: EmailForwardAttachmentManifestEntry[] = [];
    for (const attachment of rawAttachments) {
      const selected =
        input.attachmentSelection.mode === "all" ||
        (selectedPartIds !== null && selectedPartIds.has(attachment.partId));
      const displayName = dedupeDisplayName(manifest, sanitizeFilename(attachment.displayName));
      const artifactId = selected
        ? await this.artifactStore.put(attachment.content)
        : null;
      manifest.push({
        partId: attachment.partId,
        displayName,
        contentType: attachment.contentType,
        decodedSize: attachment.content.length,
        contentHash: hashBytes(attachment.content),
        disposition: attachment.disposition,
        contentId: attachment.cid,
        selected,
        artifactId,
      });
    }

    // ---- Forward content ----
    const originalText =
      parsed.text !== undefined && parsed.text !== null && parsed.text !== ""
        ? parsed.text
        : htmlToText(parsed.html ?? "");
    // mailparser inlines CID images as data: URIs in parsed.html. The
    // forward must reference the ACTUAL selected parts instead (R01).
    const relinkFindings: string[] = [];
    const parsedHtml: string | null = typeof parsed.html === "string" ? parsed.html : null;
    const relinkedHtml = relinkCidImages(
      parsedHtml,
      rawAttachments,
      input.attachmentSelection,
      relinkFindings
    );
    // R01: forward-specific sanitization RETAINS cid: references (the
    // selected inline assets travel with the message) while blocking remote
    // content. Null HTML stays null so the text alternative is used.
    const originalHtml = relinkedHtml === null ? null : sanitizeForwardedEmailHtml(relinkedHtml);
    const findings: string[] = [...relinkFindings];
    const forwardedHtml = stripRemoteImages(originalHtml, findings);
    if (originalHtml !== null && originalHtml !== forwardedHtml) {
      findings.push("remote_images_removed");
    }
    if (parsed.headers.has("content-type") === false && parsed.text) {
      findings.push("text_only_source");
    }

    // R01: the quoted header block reflects the ORIGINAL message — the
    // outgoing (possibly edited/Fwd-prefixed) subject is separate.
    const headerBlock = buildForwardedHeaderBlock(parsed, input.locale ?? "en");
    const bodyText = buildTextBody(input.note, headerBlock, originalText);
    const bodyHtml = buildHtmlBody(input.note, headerBlock, forwardedHtml, originalText);

    const bodyTextArtifactId = await this.artifactStore.put(Buffer.from(bodyText, "utf8"));
    const bodyHtmlArtifactId = await this.artifactStore.put(Buffer.from(bodyHtml, "utf8"));

    const selected = manifest.filter((entry) => entry.selected);
    const composedByteCount = estimateComposedBytes(bodyText, bodyHtml, selected.map((entry) => ({
      content: rawAttachments.find((att) => att.partId === entry.partId)?.content ?? Buffer.alloc(0),
    })));
    if (composedByteCount > EMAIL_ORGANIZATION_LIMITS.maxComposedBytes) {
      throw new EmailOrganizationActionError(
        "SOURCE_TOO_LARGE",
        `Composed message exceeds the ${Math.floor(EMAIL_ORGANIZATION_LIMITS.maxComposedBytes / (1024 * 1024))} MiB bound.`,
        false
      );
    }
    return {
      composedByteCount,
      sourceFullSourceHash,
      sourceLocationSnapshotJson: JSON.stringify(input.location),
      bodyText,
      bodyHtml,
      bodyTextArtifactId,
      bodyHtmlArtifactId,
      bodyTextHash: hashBytes(bodyText),
      bodyHtmlHash: hashBytes(bodyHtml),
      attachments: manifest,
      selectedAttachmentCount: selected.length,
      selectedAttachmentBytes: selected.reduce((sum, entry) => sum + entry.decodedSize, 0),
      validationFindings: findings,
    };
  }
}

const UNSUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set([
  "multipart/encrypted",
  "multipart/signed",
  "application/pgp-encrypted",
  "application/pgp-signature",
  "application/pgp-keys",
  "application/pkcs7-mime",
  "application/pkcs7-signature",
  "application/x-pkcs7-mime",
  "application/x-pkcs7-signature",
  "application/smime",
]);

/**
 * R18: rejects signed/encrypted content at ANY nesting depth (top-level
 * multipart plus nested parts/S/MIME), not just the outer container.
 */
function assertSupportedMime(parsed: ParsedMail): void {
  const contentType = parsed.headers.get("content-type");
  const type = typeof contentType === "object" && contentType !== null
    ? String((contentType as { value?: string }).value ?? "").toLowerCase()
    : "";
  if (UNSUPPORTED_MIME_TYPES.has(type)) {
    throw new EmailOrganizationActionError(
      "MIME_UNSUPPORTED",
      "Encrypted or signed messages cannot be forwarded without degrading content.",
      false
    );
  }
  for (const attachment of parsed.attachments ?? []) {
    const attachmentType = (attachment.contentType ?? "").toLowerCase();
    if (UNSUPPORTED_MIME_TYPES.has(attachmentType)) {
      throw new EmailOrganizationActionError(
        "MIME_UNSUPPORTED",
        "The message contains signed/encrypted content at a nested part; forwarding would degrade it.",
        false
      );
    }
  }
}

/**
 * R18: conservative composed-message size bound — every part is counted at
 * its base64 expansion (the true upper bound regardless of the encoder's
 * choices), plus bounded header/recipient overhead. Unknown provider limits
 * are enforced at the conservative 25 MiB; a lower server limit still
 * surfaces accurately as a provider rejection at submit time.
 */
export function estimateComposedBytes(
  bodyText: string,
  bodyHtml: string,
  selectedAttachments: ReadonlyArray<{ readonly content: Buffer }>
): number {
  const encoded = (bytes: number): number => 4 * Math.ceil(bytes / 3);
  const textBytes = Buffer.byteLength(bodyText, "utf8");
  const htmlBytes = Buffer.byteLength(bodyHtml, "utf8");
  const attachmentsBytes = selectedAttachments.reduce(
    (sum, entry) => sum + encoded(entry.content.length),
    0
  );
  // Bodies + headers + MIME boundaries, all conservatively base64-counted.
  return encoded(textBytes) + encoded(htmlBytes) + attachmentsBytes + 8192;
}

function extractAttachments(parsed: ParsedMail): RawAttachment[] {
  const attachments: RawAttachment[] = [];
  let index = 0;
  for (const attachment of parsed.attachments ?? []) {
    index += 1;
    const disposition =
      attachment.contentDisposition === "inline" ? "inline" : "attachment";
    attachments.push({
      partId: `part-${index}`,
      displayName:
        attachment.filename ??
        (disposition === "inline" ? `inline-${index}` : `attachment-${index}`),
      contentType: attachment.contentType ?? null,
      content: attachment.content,
      cid: attachment.cid ?? null,
      disposition,
    });
  }
  return attachments;
}

export function sanitizeFilename(name: string): string {
  const base = path_base(name);
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").trim();
  const safe = cleaned.length > 0 ? cleaned.slice(0, 120) : "attachment";
  return safe;
}

function path_base(name: string): string {
  // Never use the sender's filename as a filesystem path; keep the leaf only.
  const parts = name.split(/[/\\]/);
  return parts[parts.length - 1] ?? name;
}

function dedupeDisplayName(
  existing: readonly EmailForwardAttachmentManifestEntry[],
  candidate: string
): string {
  const taken = new Set(existing.map((entry) => entry.displayName));
  if (!taken.has(candidate)) return candidate;
  let counter = 2;
  while (taken.has(`${candidateWithoutExtension(candidate)} (${counter})${extensionOf(candidate)}`)) {
    counter += 1;
  }
  return `${candidateWithoutExtension(candidate)} (${counter})${extensionOf(candidate)}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

function candidateWithoutExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function formatAddress(name: string | undefined, address: string | undefined): string {
  const safeAddress = address ?? "";
  if (!name) return safeAddress;
  return `${name} <${safeAddress}>`;
}

function buildForwardedHeaderBlock(parsed: ParsedMail, locale: string): string {
  const labels = forwardLabelsForLocale(locale);
  const fromDate = parsed.date ? parsed.date.toUTCString() : "";
  const lines = [
    labels.separator,
    `${labels.from}: ${formatAddress(parsed.from?.value?.[0]?.name, parsed.from?.value?.[0]?.address)}`,
    `${labels.date}: ${fromDate}`,
    `${labels.subject}: ${parsed.subject ?? ""}`,
    `${labels.to}: ${(parsed.to ? addressList(parsed.to) : []).join(", ")}`,
  ];
  return lines.join("\n");
}

function addressList(value: ParsedMail["to"]): string[] {
  const addresses: Array<{ name?: string; address?: string }> = Array.isArray(value)
    ? value.flatMap((entry) => entry.value)
    : (value?.value ?? []);
  return addresses
    .map((entry) => formatAddress(entry.name, entry.address))
    .filter((entry) => entry !== "");
}

function buildTextBody(note: string | null, headerBlock: string, originalText: string): string {
  const noteBlock = note && note.trim() !== "" ? `${note.trim()}\n\n` : "";
  return `${noteBlock}${headerBlock}\n\n${originalText}`;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlBody(
  note: string | null,
  headerBlock: string,
  originalHtml: string | null,
  originalText: string
): string {
  const noteBlock =
    note && note.trim() !== "" ? `<p>${escapeHtmlText(note.trim())}</p>` : "";
  const headerHtml = headerBlock
    .split("\n")
    .map((line) => `<div>${escapeHtmlText(line)}</div>`)
    .join("");
  // R01: an empty HTML alternative must not win over the original text.
  const bodyHtml =
    originalHtml && originalHtml.trim() !== ""
      ? originalHtml
      : `<pre>${escapeHtmlText(originalText)}</pre>`;
  return `<div class="aifetchly-forward">${noteBlock}${headerHtml}<br>${bodyHtml}</div>`;
}

/**
 * Forward-specific HTML sanitization (R01): identical protection to the
 * shared incoming sanitizer, plus `cid:` scheme retention so inline assets
 * selected for the forward stay referenced by the forwarded HTML. Does NOT
 * loosen the general incoming sanitizer used at receive time.
 */
const DATA_URI_PATTERN =
  /src\s*=\s*(["'])(data:[^;]+;base64,([A-Za-z0-9+/=\s]+?))\1/gi;

/**
 * R01: mailparser inlines CID images as data: URIs. Relink each inlined
 * image back to its `cid:` content-id when the owning part is SELECTED;
 * drop the image when the part exists but was not selected. Returns null
 * only when the input is null (text-only source).
 */
export function relinkCidImages(
  html: string | null,
  rawAttachments: ReadonlyArray<{
    readonly partId: string;
    readonly cid: string | null;
    readonly content: Buffer;
  }>,
  selection: EmailForwardAttachmentSelection,
  findings: string[]
): string | null {
  if (html === null) return null;
  const byBase64 = new Map<string, { cid: string; selected: boolean }>();
  for (const attachment of rawAttachments) {
    if (attachment.cid === null) continue;
    const key = attachment.content.toString("base64").replace(/\s/g, "");
    const selected =
      selection.mode === "all" ||
      (selection.mode === "parts" && selection.partIds.includes(attachment.partId));
    byBase64.set(key, { cid: attachment.cid, selected });
  }
  return html.replace(DATA_URI_PATTERN, (match, _quote: string, _uri: string, base64: string) => {
    const key = base64.replace(/\s/g, "");
    const match_ = byBase64.get(key);
    if (match_ === undefined) return match; // unrelated embedded data URI
    if (!match_.selected) {
      findings.push("unselected_inline_image_removed");
      return 'src=""';
    }
    return `src="cid:${match_.cid}"`;
  });
}

export function sanitizeForwardedEmailHtml(html: string): string {
  const schemes = Array.isArray(SANITIZE_OPTIONS.allowedSchemes)
    ? SANITIZE_OPTIONS.allowedSchemes
    : ["http", "https", "mailto"];
  // data: is allowed so mailparser-inlined CID images survive to the relink
  // pass; unmatched data: URIs are self-contained (not remote) content.
  return sanitizeHtml(html, {
    ...SANITIZE_OPTIONS,
    allowedSchemes: [...schemes, "cid", "data"],
  });
}

/** Remove remote (http/https) image sources; keep CID-referenced inline assets. */
export function stripRemoteImages(html: string | null, findings: string[]): string | null {
  if (html === null) return null;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = /src\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const src = srcMatch?.[2] ?? srcMatch?.[3] ?? "";
    if (src.toLowerCase().startsWith("cid:")) return tag;
    if (src === "" || src.toLowerCase().startsWith("data:")) return tag;
    findings.push("remote_image_removed");
    return tag.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i, ' src=""');
  });
}
