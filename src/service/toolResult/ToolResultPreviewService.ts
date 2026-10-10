import "reflect-metadata";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import {
  boundUntrustedValue,
  truncateAtLineBoundary,
  truncateUtf8Safe,
  utf8ByteLength,
} from "@/service/ToolResultTextUtil";
import type { ToolResultPreviewKind } from "@/entityTypes/toolResultTypes";

/**
 * Deterministic bounded previews (technical design §6.2).
 *
 * A preview must be USEFUL and must be visibly PARTIAL. Two rules drive the
 * whole design here:
 *
 *  - NEVER imply complete coverage from a small sample. `previewComplete` is
 *    only true when the preview really is the whole captured output.
 *  - NEVER make a provider call. A summary request would be another
 *    size-sensitive operation before the data is even safe to send, and an AI
 *    summary must not be the only surviving copy of a result.
 *
 * For structured data, complete sampled RECORDS and the available FIELD NAMES
 * are far more useful to an assistant than a raw prefix of minified JSON,
 * which is usually one unparseable line.
 */

/** Input describing what to preview. */
export interface PreviewRequest {
  /** The captured text, when the source is text/log shaped. */
  readonly text?: string;
  /** A parsed value, when the source is JSON shaped. */
  readonly value?: unknown;
  readonly kind: ToolResultPreviewKind;
  /** True when `text`/`value` is the entire captured output. */
  readonly isComplete: boolean;
}

/** A bounded preview plus whether it represents everything. */
export interface PreviewResult {
  readonly text: string;
  readonly previewComplete: boolean;
  /** Structured hint for the UI (field names, counts). Never bulk data. */
  readonly recordCount?: number;
  readonly fieldNames?: readonly string[];
}

/** Marker inserted where a head/tail preview omitted the middle. */
export const OMITTED_REGION_MARKER = "\n… [middle of output omitted] …\n";

export class ToolResultPreviewService {
  private readonly maxBytes: number;

  constructor(maxBytes: number = TOOL_RESULT_CONFIG.previewMaxBytes) {
    this.maxBytes = maxBytes;
  }

  /** Build a bounded preview for one captured output. */
  build(request: PreviewRequest): PreviewResult {
    switch (request.kind) {
      case "records":
        return this.recordsPreview(request);
      case "head_tail":
        return this.headTailPreview(request);
      case "text":
      default:
        return this.textPreview(request);
    }
  }

  /**
   * Text preview: a UTF-8-safe prefix that prefers to end on a line boundary
   * so a record is not cut in half when a boundary is nearby.
   */
  private textPreview(request: PreviewRequest): PreviewResult {
    const source = request.text ?? this.stringifyShallow(request.value);
    if (source.length === 0) {
      return { text: "(empty output)", previewComplete: request.isComplete };
    }
    if (request.isComplete && utf8ByteLength(source) <= this.maxBytes) {
      return { text: source, previewComplete: true };
    }
    const body = truncateAtLineBoundary(source, this.maxBytes);
    return {
      text: `${body}\n… [preview truncated; use the saved output reference to read more]`,
      previewComplete: false,
    };
  }

  /**
   * Log preview: bounded head AND tail with an explicit omitted-region marker.
   * A log's actionable content is often at the end, but showing a prefix and a
   * suffix without a marker would read as if the two were continuous.
   */
  private headTailPreview(request: PreviewRequest): PreviewResult {
    const source = request.text ?? this.stringifyShallow(request.value);
    if (request.isComplete && utf8ByteLength(source) <= this.maxBytes) {
      return { text: source, previewComplete: true };
    }
    // Split the allowance so both ends are represented.
    const half = Math.floor(this.maxBytes / 2);
    const head = truncateUtf8Safe(source, half);
    const markerCost = OMITTED_REGION_MARKER.length;
    const tailBudget = Math.max(
      0,
      this.maxBytes - utf8ByteLength(head) - markerCost
    );
    // The tail is a SUFFIX of the source, not another prefix.
    const tail = takeUtf8Suffix(source, tailBudget);
    return {
      text: `${head}${OMITTED_REGION_MARKER}${tail}\n… [preview truncated; use the saved output reference to read more]`,
      previewComplete: false,
    };
  }

  /**
   * Record preview: counts, field names, and a bounded sample of COMPLETE
   * records in source order. A complete record is the point - a raw JSON prefix
   * usually ends mid-object and teaches the assistant nothing.
   */
  private recordsPreview(request: PreviewRequest): PreviewResult {
    const value = request.value;
    const records = Array.isArray(value) ? value : undefined;
    if (!records) {
      // Not actually record-shaped; fall back to a bounded structural summary
      // rather than inventing a record framing.
      return this.structuralPreview(value, request);
    }

    const fieldNames = collectFieldNames(records);
    const header =
      records.length === 1
        ? `1 record. Fields: ${fieldNames.join(", ") || "(none)"}`
        : `${records.length} records. Fields: ${fieldNames.join(", ") || "(none)"}`;

    const sampleLines: string[] = [];
    let used = utf8ByteLength(header);
    for (const record of records) {
      if (used >= this.maxBytes) break;
      const line = safeJsonLine(record);
      const cost = utf8ByteLength(line) + 1;
      if (used + cost > this.maxBytes) break;
      sampleLines.push(line);
      used += cost;
    }

    const allSampled = sampleLines.length === records.length;
    const body = [header, ...sampleLines].join("\n");
    const previewComplete = request.isComplete && allSampled;
    return {
      text: previewComplete
        ? body
        : `${body}\n… [showing ${sampleLines.length} of ${records.length} records; use the saved output reference to read more]`,
      previewComplete,
      recordCount: records.length,
      fieldNames,
    };
  }

  /**
   * Unknown-shape JSON: top-level keys plus bounded primitive values. Never
   * emitted as a structured JSON envelope, because a bounded projection of a
   * large object is NOT valid JSON and labelling it as such would be a lie the
   * model could act on.
   */
  private structuralPreview(value: unknown, request: PreviewRequest): PreviewResult {
    if (value === null || typeof value !== "object") {
      return this.textPreview(request);
    }
    if (Array.isArray(value)) {
      return this.textPreview(request);
    }
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    const fieldNames: string[] = [];
    const lines: string[] = [];
    let used = 0;
    for (const key of keys) {
      const child = source[key];
      fieldNames.push(key);
      const rendered =
        child !== null && typeof child === "object"
          ? Array.isArray(child)
            ? `[array ${child.length} items]`
            : `{object ${Object.keys(child as object).length} keys}`
          : JSON.stringify(child) ?? String(child);
      const line = `${key}: ${truncateUtf8Safe(rendered, 200)}`;
      const cost = utf8ByteLength(line) + 1;
      if (used + cost > this.maxBytes) break;
      lines.push(line);
      used += cost;
    }
    const body = lines.length > 0 ? lines.join("\n") : "(no top-level fields)";
    return {
      text: `${body}\n… [structural preview only; use the saved output reference to read more]`,
      previewComplete: false,
      fieldNames,
    };
  }

  /** Shallow JSON for a non-string source. Never used for large values. */
  private stringifyShallow(value: unknown): string {
    if (value === undefined) return "";
    if (typeof value === "string") return value;
    if (value === null) return "null";
    const bounded = boundUntrustedValue(value, {
      maxKeys: TOOL_RESULT_CONFIG.controlMaxKeys,
      maxArrayItems: TOOL_RESULT_CONFIG.controlMaxArrayItems,
      maxStringChars: 500,
    });
    try {
      return JSON.stringify(bounded) ?? "";
    } catch {
      return String(value);
    }
  }
}

/**
 * Take the last `maxBytes` UTF-8 bytes of a string without splitting a
 * multi-byte character.
 *
 * A head/tail preview needs a SUFFIX. Reusing the prefix truncation helper
 * here would silently show a second copy of the head and no tail at all, which
 * is worse than showing nothing: it looks like the end of the log.
 */
function takeUtf8Suffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;
  // Binary-search the code-unit start that keeps the suffix within budget.
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (utf8ByteLength(value.slice(mid)) <= maxBytes) high = mid;
    else low = mid + 1;
  }
  let start = low;
  // If the cut landed on a low surrogate, advance past it so the first
  // character is not a lone trailing half.
  if (
    start > 0 &&
    start < value.length &&
    value.charCodeAt(start - 1) >= 0xdc00 &&
    value.charCodeAt(start - 1) <= 0xdfff
  ) {
    start += 1;
  }
  return value.slice(start);
}

/** Union of field names across sampled records, in first-seen order. */
function collectFieldNames(records: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const record of records) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }
    for (const key of Object.keys(record as Record<string, unknown>)) {
      seen.add(key);
    }
  }
  return [...seen];
}

/** One record per line, or a short marker when it cannot be rendered. */
function safeJsonLine(record: unknown): string {
  try {
    return JSON.stringify(record) ?? String(record);
  } catch {
    return "[unrenderable record]";
  }
}
