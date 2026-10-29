/**
 * PortableWorkspaceMemoryFormat — pure parser/serializer for the portable
 * memory file contract (PRD §9, design §7).
 *
 * PURE MODULE: imports only pure helpers (js-yaml, crypto, MemorySecretFilter,
 * shared types). It must never import Electron, TypeORM, Modules, Models, or
 * Vue — it is used by the main process AND covered by utilitycode tests.
 *
 * Contract:
 *   - `parseDraft` performs full structural + schema validation of a bounded
 *     worker draft (frontmatter as `unknown`, markdown body). It never throws:
 *     every failure is a typed diagnostic.
 *   - `serialize` emits canonical, byte-stable Markdown: LF line endings,
 *     frontmatter fields in PRD order, one blank line, `# title`, content.
 *   - The serializer round-trips: `parse(serialize(doc))` reproduces the doc.
 *   - Secret-like titles/content are rejected with `memory-secret-rejected`
 *     for BOTH app writes and imports (design §16.2 recommendation).
 */

import yaml from "js-yaml";
import { createHash } from "crypto";
import { looksSecretlike } from "@/service/MemorySecretFilter";
import type {
  PortableMemoryDiagnosticView,
  PortableMemoryDocumentV1,
  PortableMemoryFileDraft,
  PortableMemoryFrontmatterV1,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import {
  PORTABLE_MEMORY_LIMITS,
  PORTABLE_MEMORY_ID_PATTERN,
  isPortableMemoryVisibility,
  isPortableMemoryCreatedBy,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import type {
  AIWorkspaceMemoryStatus,
  AIWorkspaceMemoryType,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import {
  isAIWorkspaceMemoryType,
  isAIWorkspaceMemoryStatus,
} from "@/entityTypes/aiWorkspaceMemoryTypes";

export type PortableMemoryParseResult =
  | {
      readonly ok: true;
      readonly document: PortableMemoryDocumentV1;
      readonly warnings: readonly PortableMemoryDiagnosticView[];
    }
  | {
      readonly ok: false;
      readonly diagnostic: PortableMemoryDiagnosticView;
    };

const SCHEMA_VALUE = "aifetchly.memory/v1";
const MEMORY_DIR_PREFIX = ".aifetchly/memory/";

// Canonical frontmatter field order (PRD §9.1 example).
const FIELD_ORDER = [
  "schema",
  "id",
  "type",
  "status",
  "confidence",
  "visibility",
  "createdAt",
  "updatedAt",
  "createdBy",
  "supersedes",
  "tags",
  "reviewedAt",
  "reviewedBy",
] as const;

export class PortableWorkspaceMemoryFormat {
  /**
   * Validate + convert a bounded worker draft into a trusted document.
   * Never throws; every failure is a typed diagnostic with the relative path.
   */
  parseDraft(draft: PortableMemoryFileDraft): PortableMemoryParseResult {
    const warnings: PortableMemoryDiagnosticView[] = [];

    if (draft.isSymbolicLink) {
      return fail(
        "memory-symlink-rejected",
        "symbolic links are not supported"
      );
    }
    if (draft.sizeBytes > PORTABLE_MEMORY_LIMITS.maxFileBytes) {
      return fail(
        "memory-file-too-large",
        `file exceeds ${PORTABLE_MEMORY_LIMITS.maxFileBytes} bytes`
      );
    }
    if (draft.syntaxError) {
      return fail("memory-frontmatter-invalid", draft.syntaxError);
    }
    if (
      typeof draft.rawFrontmatter !== "object" ||
      draft.rawFrontmatter === null
    ) {
      return fail(
        "memory-frontmatter-invalid",
        "frontmatter must be a mapping"
      );
    }

    const raw = draft.rawFrontmatter as Record<string, unknown>;
    const known = new Set<string>(FIELD_ORDER);
    for (const key of Object.keys(raw)) {
      if (!known.has(key)) {
        warnings.push({
          code: "memory-field-invalid",
          relativePath: draft.relativePath,
          message: `unknown frontmatter field "${key}" ignored`,
          recoverable: true,
        });
      }
    }

    if (raw.schema !== SCHEMA_VALUE) {
      return fail(
        "memory-schema-unsupported",
        `unsupported schema "${String(raw.schema)}" (expected ${SCHEMA_VALUE})`
      );
    }

    const id = raw.id;
    if (typeof id !== "string" || !PORTABLE_MEMORY_ID_PATTERN.test(id)) {
      return fail("memory-id-invalid", "id must be wmem-<uuid>");
    }
    const expectedFile = `${id}.md`;
    if (draft.fileName !== expectedFile) {
      return fail(
        "memory-id-path-mismatch",
        `file name must equal "${expectedFile}"`
      );
    }

    if (!isAIWorkspaceMemoryType(raw.type)) {
      return fail("memory-field-invalid", `invalid type "${String(raw.type)}"`);
    }
    if (!isAIWorkspaceMemoryStatus(raw.status)) {
      return fail(
        "memory-field-invalid",
        `invalid status "${String(raw.status)}"`
      );
    }

    const confidence = raw.confidence;
    if (
      typeof confidence !== "number" ||
      !Number.isInteger(confidence) ||
      confidence < 0 ||
      confidence > 100
    ) {
      return fail(
        "memory-field-invalid",
        "confidence must be an integer 0..100"
      );
    }

    if (!isPortableMemoryVisibility(raw.visibility)) {
      return fail(
        "memory-field-invalid",
        `invalid visibility "${String(raw.visibility)}"`
      );
    }

    const createdAt = parseTimestamp(raw.createdAt);
    if (!createdAt) {
      return fail(
        "memory-field-invalid",
        "createdAt must be a valid UTC ISO 8601 timestamp"
      );
    }
    const updatedAt = parseTimestamp(raw.updatedAt);
    if (!updatedAt) {
      return fail(
        "memory-field-invalid",
        "updatedAt must be a valid UTC ISO 8601 timestamp"
      );
    }
    if (updatedAt.getTime() < createdAt.getTime()) {
      return fail(
        "memory-field-invalid",
        "updatedAt must not precede createdAt"
      );
    }

    if (!isPortableMemoryCreatedBy(raw.createdBy)) {
      return fail(
        "memory-field-invalid",
        `invalid createdBy "${String(raw.createdBy)}"`
      );
    }

    const supersedesResult = parseIdArray(
      raw.supersedes,
      "supersedes",
      PORTABLE_MEMORY_LIMITS.maxSupersedesPerRecord
    );
    if (typeof supersedesResult === "string") {
      return fail("memory-field-invalid", supersedesResult);
    }
    const tagsResult = parseTags(raw.tags);
    if (typeof tagsResult === "string") {
      return fail("memory-field-invalid", tagsResult);
    }
    if (raw.reviewedAt !== undefined) {
      if (!parseTimestamp(raw.reviewedAt)) {
        return fail(
          "memory-field-invalid",
          "reviewedAt must be a valid UTC ISO 8601 timestamp"
        );
      }
    }
    if (raw.reviewedBy !== undefined) {
      if (
        typeof raw.reviewedBy !== "string" ||
        raw.reviewedBy.length > PORTABLE_MEMORY_LIMITS.maxReviewedByChars
      ) {
        return fail(
          "memory-field-invalid",
          `reviewedBy must be a string of at most ${PORTABLE_MEMORY_LIMITS.maxReviewedByChars} characters`
        );
      }
    }

    // --- Markdown body: first H1 outside code fences is the title ----------
    const body = draft.markdownBody.replace(/\r\n/g, "\n");
    const extracted = extractTitle(body);
    if (!extracted) {
      return fail("memory-content-invalid", "memory content is required");
    }
    const { title, content } = extracted;
    if (
      title.length < 1 ||
      title.length > PORTABLE_MEMORY_LIMITS.maxTitleChars
    ) {
      return fail(
        "memory-content-invalid",
        `title length must be 1..${PORTABLE_MEMORY_LIMITS.maxTitleChars}`
      );
    }
    const trimmedContent = content.trim();
    if (
      trimmedContent.length < 1 ||
      trimmedContent.length > PORTABLE_MEMORY_LIMITS.maxContentChars
    ) {
      return fail(
        "memory-content-invalid",
        `content length must be 1..${PORTABLE_MEMORY_LIMITS.maxContentChars}`
      );
    }

    // --- Secret filter (manual + automatic, design §16.2) ------------------
    if (looksSecretlike(title) || looksSecretlike(trimmedContent)) {
      return fail(
        "memory-secret-rejected",
        "memory content looks like a secret or credential"
      );
    }

    const frontmatter: PortableMemoryFrontmatterV1 = {
      schema: SCHEMA_VALUE,
      id,
      type: raw.type,
      status: raw.status,
      confidence,
      visibility: raw.visibility,
      createdAt: toCanonicalTimestamp(createdAt),
      updatedAt: toCanonicalTimestamp(updatedAt),
      createdBy: raw.createdBy,
      ...(supersedesResult.length > 0
        ? { supersedes: supersedesResult }
        : {}),
      ...(tagsResult.length > 0 ? { tags: tagsResult } : {}),
      ...(raw.reviewedAt !== undefined
        ? {
            reviewedAt: toCanonicalTimestamp(
              parseTimestamp(raw.reviewedAt) as Date
            ),
          }
        : {}),
      ...(raw.reviewedBy !== undefined ? { reviewedBy: raw.reviewedBy } : {}),
    };

    return {
      ok: true,
      document: {
        frontmatter,
        title: title.trim(),
        content: trimmedContent,
        relativePath: draft.relativePath,
        contentHash: draft.contentHash,
        sizeBytes: draft.sizeBytes,
        mtimeMs: draft.mtimeMs,
      },
      warnings,
    };
  }

  /**
   * Canonical, byte-stable serialization. `hashDocument` over the returned
   * string is the content hash stored as `lastValidHash`.
   */
  serialize(document: PortableMemoryDocumentV1): string {
    const fm: Record<string, unknown> = {};
    const f = document.frontmatter;
    fm.schema = f.schema;
    fm.id = f.id;
    fm.type = f.type;
    fm.status = f.status;
    fm.confidence = f.confidence;
    fm.visibility = f.visibility;
    fm.createdAt = f.createdAt;
    fm.updatedAt = f.updatedAt;
    fm.createdBy = f.createdBy;
    if (f.supersedes && f.supersedes.length > 0)
      fm.supersedes = [...f.supersedes];
    if (f.tags && f.tags.length > 0) fm.tags = [...f.tags];
    if (f.reviewedAt !== undefined) fm.reviewedAt = f.reviewedAt;
    if (f.reviewedBy !== undefined) fm.reviewedBy = f.reviewedBy;

    const frontmatterYaml = yaml.dump(fm, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
    });
    const trimmedYaml = frontmatterYaml.replace(/\n+$/, "");

    const body = `# ${document.title.trim()}\n\n${document.content.trim()}\n`;
    return `---\n${trimmedYaml}\n---\n\n${body.replace(/\r\n/g, "\n")}`;
  }

  /** sha256 over the canonical serialized bytes (design §7.5). */
  hashCanonicalDocument(document: PortableMemoryDocumentV1): string {
    return sha256Hex(this.serialize(document));
  }

  /**
   * Convenience builder used by app-side create/promote flows: produces a
   * document whose relative path/hash fields are filled by the caller after
   * the file write (hash of the serialized bytes).
   */
  buildDocument(input: {
    readonly id: string;
    readonly type: AIWorkspaceMemoryType;
    readonly status: AIWorkspaceMemoryStatus;
    readonly confidence: number;
    readonly visibility: PortableMemoryFrontmatterV1["visibility"];
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly createdBy: PortableMemoryFrontmatterV1["createdBy"];
    readonly title: string;
    readonly content: string;
    readonly supersedes?: readonly string[];
    readonly tags?: readonly string[];
  }): PortableMemoryDocumentV1 {
    return {
      frontmatter: {
        schema: SCHEMA_VALUE,
        id: input.id,
        type: input.type,
        status: input.status,
        confidence: clampInt(input.confidence, 0, 100),
        visibility: input.visibility,
        createdAt: toCanonicalTimestamp(input.createdAt),
        updatedAt: toCanonicalTimestamp(input.updatedAt),
        createdBy: input.createdBy,
        ...(input.supersedes && input.supersedes.length > 0
          ? { supersedes: [...input.supersedes] }
          : {}),
        ...(input.tags && input.tags.length > 0
          ? { tags: [...input.tags] }
          : {}),
      },
      title: input.title.trim(),
      content: input.content.trim(),
      relativePath: `${MEMORY_DIR_PREFIX}${input.id}.md`,
      contentHash: "",
      sizeBytes: 0,
      mtimeMs: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(
  code: PortableMemoryDiagnosticView["code"],
  message: string,
  relativePath = ""
): { ok: false; diagnostic: PortableMemoryDiagnosticView } {
  return {
    ok: false,
    diagnostic: {
      code,
      relativePath,
      message,
      recoverable: code !== "memory-symlink-rejected",
    },
  };
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Strict UTC ISO-8601 with Z suffix (PRD §9.2). */
function parseTimestamp(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v))
    return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toCanonicalTimestamp(d: Date): string {
  return d.toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

function parseIdArray(
  v: unknown,
  field: string,
  max: number
): string[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return `${field} must be an array of memory ids`;
  if (v.length > max) return `${field} exceeds ${max} entries`;
  for (const item of v) {
    if (typeof item !== "string" || !PORTABLE_MEMORY_ID_PATTERN.test(item)) {
      return `${field} entries must be valid memory ids`;
    }
  }
  return [...v];
}

function parseTags(v: unknown): string[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return "tags must be an array of strings";
  if (v.length > PORTABLE_MEMORY_LIMITS.maxTagsPerRecord)
    return `tags exceeds ${PORTABLE_MEMORY_LIMITS.maxTagsPerRecord} entries`;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return "tags entries must be strings";
    const normalized = item.trim().toLowerCase();
    if (normalized.length < 1 || normalized.length > 64) {
      return "tags entries must be 1..64 characters";
    }
    out.push(normalized);
  }
  return out;
}

/**
 * Extract the first H1 heading outside fenced code blocks (design §7.3).
 * Returns the title and the remaining content with the heading line (and one
 * following blank line) removed.
 */
export function extractTitle(
  body: string
): { readonly title: string; readonly content: string } | null {
  const lines = body.split("\n");
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      const title = h1[1].trim();
      let contentStart = i + 1;
      if (contentStart < lines.length && lines[contentStart].trim() === "") {
        contentStart += 1;
      }
      return { title, content: lines.slice(contentStart).join("\n") };
    }
  }
  return null;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return max;
  return Math.max(min, Math.min(max, Math.round(v)));
}
