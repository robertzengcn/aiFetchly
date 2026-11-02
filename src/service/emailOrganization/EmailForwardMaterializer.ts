import { simpleParser, type ParsedMail } from "mailparser";
import { sanitizeEmailHtml } from "@/service/emailReceive/EmailHtmlSanitizer";
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

    // ---- Attachments (regular + inline CID assets), sanitized manifest ----
    const rawAttachments = extractAttachments(parsed);
    const totalBytes = rawAttachments.reduce((sum, att) => sum + att.content.length, 0);
    if (rawAttachments.length > EMAIL_ORGANIZATION_LIMITS.maxAttachments) {
      throw new EmailOrganizationActionError(
        "TOO_MANY_ATTACHMENTS",
        `Source carries ${rawAttachments.length} attachments; the limit is ${EMAIL_ORGANIZATION_LIMITS.maxAttachments}.`,
        false
      );
    }
    if (totalBytes > EMAIL_ORGANIZATION_LIMITS.maxTotalAttachmentBytes) {
      throw new EmailOrganizationActionError(
        "ATTACHMENT_TOO_LARGE",
        "Total decoded attachment size exceeds the 15 MiB limit.",
        false
      );
    }

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
      }
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
    const originalHtml = parsed.html ? sanitizeEmailHtml(parsed.html) : null;
    const findings: string[] = [];
    const forwardedHtml = stripRemoteImages(originalHtml, findings);
    if (originalHtml !== null && originalHtml !== forwardedHtml) {
      findings.push("remote_images_removed");
    }
    if (parsed.headers.has("content-type") === false && parsed.text) {
      findings.push("text_only_source");
    }

    const headerBlock = buildForwardedHeaderBlock(parsed, input.subject);
    const bodyText = buildTextBody(input.note, headerBlock, originalText);
    const bodyHtml = buildHtmlBody(input.note, headerBlock, forwardedHtml, originalText);

    const bodyTextArtifactId = await this.artifactStore.put(Buffer.from(bodyText, "utf8"));
    const bodyHtmlArtifactId = await this.artifactStore.put(Buffer.from(bodyHtml, "utf8"));

    const selected = manifest.filter((entry) => entry.selected);
    return {
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

function assertSupportedMime(parsed: ParsedMail): void {
  const contentType = parsed.headers.get("content-type");
  const type = typeof contentType === "object" && contentType !== null
    ? String((contentType as { value?: string }).value ?? "").toLowerCase()
    : "";
  if (type.startsWith("multipart/encrypted") || type.startsWith("multipart/signed")) {
    throw new EmailOrganizationActionError(
      "MIME_UNSUPPORTED",
      "Encrypted or signed messages cannot be forwarded without degrading content.",
      false
    );
  }
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

function buildForwardedHeaderBlock(parsed: ParsedMail, subject: string): string {
  const fromDate = parsed.date ? parsed.date.toUTCString() : "";
  const lines = [
    FORWARD_SEPARATOR,
    `From: ${formatAddress(parsed.from?.value?.[0]?.name, parsed.from?.value?.[0]?.address)}`,
    `Date: ${fromDate}`,
    `Subject: ${subject}`,
    `To: ${(parsed.to ? addressList(parsed.to) : []).join(", ")}`,
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
  const bodyHtml = originalHtml ?? `<pre>${escapeHtmlText(originalText)}</pre>`;
  return `<div class="aifetchly-forward">${noteBlock}${headerHtml}<br>${bodyHtml}</div>`;
}

/** Remove remote (http/https) image sources; keep CID-referenced inline assets. */
export function stripRemoteImages(html: string | null, findings: string[]): string {
  if (html === null) return "";
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = /src\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const src = srcMatch?.[2] ?? srcMatch?.[3] ?? "";
    if (src.toLowerCase().startsWith("cid:")) return tag;
    if (src === "" || src.toLowerCase().startsWith("data:")) return tag;
    findings.push("remote_image_removed");
    return tag.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i, ' src=""');
  });
}
