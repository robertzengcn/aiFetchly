/**
 * PortableWorkspaceMemoryIndexService — deterministic INDEX.md generation and
 * README.md managed-block maintenance (design §16, D-08).
 *
 * Determinism rules:
 *   - INDEX.md `generatedAt` = MAX(portable updatedAt) of the indexed set
 *     (fixed epoch for an empty set) — never wall-clock — so identical
 *     records produce identical bytes (SC-004: zero rewrites when unchanged).
 *   - Sort: type priority (warning > decision > workflow > convention >
 *     reference > project), then title by locale-independent byte order,
 *     then memory id.
 *   - Summaries: deterministic whitespace-collapsed, ≤240 Unicode code
 *     points, sentence-boundary truncation, `…` only when truncated.
 *   - Output capped at 512 KiB; the cap stops BEFORE the next entry and adds
 *     a truncation notice.
 */

import type { PortableMemoryDocumentV1 } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { PORTABLE_MEMORY_LIMITS } from "@/entityTypes/portableWorkspaceMemoryTypes";

const EPOCH = "1970-01-01T00:00:00.000Z";
const INDEX_HEADER_SCHEMA = "aifetchly.memory/index-v1";
const TYPE_PRIORITY: readonly string[] = [
  "warning",
  "decision",
  "workflow",
  "convention",
  "reference",
  "project",
];

const SUMMARY_MAX_CODEPOINTS = 240;

export const README_MANAGED_START = "<!-- aifetchly:portable-memory:start -->";
export const README_MANAGED_END = "<!-- aifetchly:portable-memory:end -->";

export class PortableWorkspaceMemoryIndexService {
  /**
   * Build the deterministic INDEX.md content for the given active, synced
   * documents.
   */
  buildIndex(documents: readonly PortableMemoryDocumentV1[]): string {
    const sorted = [...documents].sort(compareDocuments);
    const generatedAt = sorted.reduce((max, d) => {
      return d.frontmatter.updatedAt > max ? d.frontmatter.updatedAt : max;
    }, EPOCH);

    const lines: string[] = [
      "# AiFetchly Workspace Memory",
      "",
      `Schema: \`${INDEX_HEADER_SCHEMA}\``,
      `Generated from records updated through: \`${generatedAt}\``,
      "",
      "> Generated file. Edit individual `wmem-*.md` records, not this index.",
      "",
    ];

    let bytes = lines.join("\n").length;
    let included = 0;
    let truncated = false;

    for (const doc of sorted) {
      const entry = this.formatEntry(doc);
      const entryBytes = Buffer.byteLength(entry + "\n", "utf8");
      if (bytes + entryBytes > PORTABLE_MEMORY_LIMITS.maxIndexBytes) {
        truncated = true;
        break;
      }
      lines.push(entry);
      bytes += entryBytes;
      included += 1;
    }

    if (truncated) {
      lines.push("");
      lines.push(
        `> Index truncated: showing ${included} of ${sorted.length} memories (size cap).`
      );
    }

    lines.push("");
    return lines.join("\n");
  }

  private formatEntry(doc: PortableMemoryDocumentV1): string {
    const fileName = `${doc.frontmatter.id}.md`;
    const summary = summarize(doc.content);
    return `- [${doc.frontmatter.type}] [${doc.title}](./${fileName}): ${summary}`;
  }

  // --- README managed block ---------------------------------------------------

  /**
   * Build the full managed README content (schema + editing rules for
   * external agents, PRD §8.2 / §13.3).
   */
  buildReadmeManagedBlock(input: {
    readonly sharingMode: "local" | "team";
  }): string {
    return [
      README_MANAGED_START,
      "",
      "## AiFetchly portable workspace memory",
      "",
      `This directory stores portable workspace memory for AiFetchly. Sharing mode: **${input.sharingMode}**.`,
      "",
      "### Record file schema (`aifetchly.memory/v1`)",
      "",
      "Each memory is one Markdown file named `<id>.md` with YAML frontmatter:",
      "",
      "```yaml",
      "---",
      "schema: aifetchly.memory/v1",
      "id: wmem-<uuid>          # must match the file name exactly",
      "type: project | decision | workflow | convention | reference | warning",
      "status: active | archived | contradicted",
      "confidence: 0..100",
      "visibility: local | team",
      "createdAt: <UTC ISO 8601>",
      "updatedAt: <UTC ISO 8601>  # set when you edit",
      "createdBy: user | aifetchly | external-agent | import",
      "---",
      "```",
      "",
      "The first `# heading` is the memory title; the remaining Markdown is the content.",
      "",
      "### Editing rules for agents and humans",
      "",
      "1. Read the current record before editing it.",
      "2. Preserve the memory `id` and `createdAt`; update `updatedAt`.",
      "3. Use only the allowed type, status, visibility, and createdBy values.",
      "4. Avoid source conversation ids, machine paths, and local-only metadata.",
      "5. One memory per file; never edit `INDEX.md` (AiFetchly regenerates it).",
      "6. NEVER store credentials, personal data, or raw transcript content.",
      "7. Files are capped at 16 KiB; content at 8,000 characters; titles at 200.",
      "",
      "Invalid or secret-like files are rejected with a diagnostic and never enter AI context.",
      "",
      README_MANAGED_END,
    ].join("\n");
  }

  /**
   * Produce the README content: replace exactly one managed block, preserving
   * all bytes outside it. Returns null when markers are malformed/duplicated
   * (the caller shows a diagnostic instead of overwriting — design §16.3).
   */
  applyManagedBlock(
    existingContent: string | null,
    managedBlock: string
  ): string | null {
    if (existingContent === null) {
      return `${managedBlock}\n`;
    }
    const startCount = existingContent.split(README_MANAGED_START).length - 1;
    const endCount = existingContent.split(README_MANAGED_END).length - 1;
    if (startCount !== 1 || endCount !== 1) {
      return null;
    }
    const startIdx = existingContent.indexOf(README_MANAGED_START);
    const endIdx = existingContent.indexOf(README_MANAGED_END);
    if (endIdx < startIdx) return null;
    const afterEnd = endIdx + README_MANAGED_END.length;
    const tail = existingContent.slice(afterEnd).replace(/^\n+/, "\n");
    return (
      existingContent.slice(0, startIdx) +
      managedBlock +
      (tail.trim().length > 0 ? tail : "\n")
    );
  }

  /** True when the file's managed block differs from the generated one. */
  needsReadmeUpdate(
    existingContent: string | null,
    managedBlock: string
  ): boolean {
    const next = this.applyManagedBlock(existingContent, managedBlock);
    return next === null || next !== existingContent;
  }
}

function compareDocuments(a: PortableMemoryDocumentV1, b: PortableMemoryDocumentV1): number {
  const pa = TYPE_PRIORITY.indexOf(a.frontmatter.type);
  const pb = TYPE_PRIORITY.indexOf(b.frontmatter.type);
  if (pa !== pb) return pa - pb;
  const ta = a.title.toLowerCase();
  const tb = b.title.toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ia = a.frontmatter.id;
  const ib = b.frontmatter.id;
  return ia === ib ? 0 : ia < ib ? -1 : 1;
}

/**
 * Deterministic summary: collapse whitespace, cap at 240 Unicode code points,
 * prefer a sentence boundary, `…` only when truncated (design §16.2).
 */
export function summarize(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  const chars = [...collapsed];
  if (chars.length <= SUMMARY_MAX_CODEPOINTS) return collapsed;
  const slice = chars.slice(0, SUMMARY_MAX_CODEPOINTS).join("");
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? ")
  );
  if (sentenceEnd > SUMMARY_MAX_CODEPOINTS / 2) {
    return slice.slice(0, sentenceEnd + 1);
  }
  return `${slice}…`;
}
