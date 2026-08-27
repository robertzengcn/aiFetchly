/**
 * PortableMemoryFileScanner — WORKER-ONLY bounded scan of
 * `<workspace>/.aifetchly/memory/` (+ workspace.json) into a typed snapshot
 * draft (design §12.2).
 *
 * Worker boundaries (D-04): enumerate, lstat, bounded read, strict UTF-8
 * decode, syntactic frontmatter/body split, SHA-256 hashing, diagnostics.
 * NO semantic validation (main process owns the schema), NO secret filter,
 * NO trust decisions, NO database access, NO Electron imports.
 *
 * Never throws: enumeration/read failures surface as diagnostics and force
 * `complete: false` so the main process applies no deletions (§14.5).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import yaml from "js-yaml";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type {
  PortableMemoryFileDraft,
  PortableMemoryScanSnapshot,
  PortableWorkspaceIdentityDraft,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import { PORTABLE_MEMORY_LIMITS } from "@/entityTypes/portableWorkspaceMemoryTypes";

const AIFETCHLY_DIR = ".aifetchly";
const MEMORY_DIR = "memory";
const WORKSPACE_JSON = "workspace.json";
const README_MD = "README.md";
const INDEX_MD = "INDEX.md";
const MAX_IDENTITY_BYTES = 8 * 1024;

export interface PortableMemoryScanInput {
  readonly workspaceRoot: string;
  /** Watcher generation for diagnostics context. */
  readonly sourceId: string;
}

/** Strict UTF-8 decode — rejects replacement-character decoding (§12.2.10). */
function decodeStrictUtf8(buf: Buffer): string | null {
  const s = buf.toString("utf8");
  // A valid UTF-8 buffer round-trips without U+FFFD unless the input truly
  // contained one; encoded � (EF BF BD) is the only legitimate source.
  if (s.includes("�") && !buf.includes(Buffer.from([0xef, 0xbf, 0xbd]))) {
    return null;
  }
  return s;
}

function diagnostic(
  sourceId: string,
  relativePath: string,
  code: string,
  message: string
): AIFetchlyConfigDiagnostic {
  return {
    severity: "warning",
    source: "workspace",
    sourceId,
    filePath: relativePath,
    code,
    message,
    recoverable: true,
  };
}

/** Syntactically split YAML frontmatter from a Markdown body. */
export function splitFrontmatter(
  text: string
): { readonly raw: unknown; readonly body: string; readonly error?: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      raw: null,
      body: normalized,
      error: "file must start with a '---' frontmatter fence",
    };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return {
      raw: null,
      body: normalized,
      error: "unterminated frontmatter fence",
    };
  }
  const yamlText = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  try {
    const parsed = yaml.load(yamlText, {
      schema: yaml.JSON_SCHEMA,
    }) as unknown;
    return { raw: parsed, body };
  } catch (err) {
    return {
      raw: null,
      body,
      error: `invalid YAML frontmatter: ${
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      }`,
    };
  }
}

export class PortableMemoryFileScanner {
  /**
   * Scan the bounded portable-memory surface. NEVER throws.
   */
  async scan(input: PortableMemoryScanInput): Promise<PortableMemoryScanSnapshot> {
    const diagnostics: AIFetchlyConfigDiagnostic[] = [];
    const records: PortableMemoryFileDraft[] = [];
    const seenRelativePaths: string[] = [];
    let totalBytes = 0;
    let complete = true;
    let directoryPresent = false;
    let readmeHash: string | undefined;
    let indexHash: string | undefined;
    let identity: PortableWorkspaceIdentityDraft | undefined;

    const aifetchlyDir = path.join(input.workspaceRoot, AIFETCHLY_DIR);
    const memoryDir = path.join(aifetchlyDir, MEMORY_DIR);
    const rel = (p: string): string =>
      path
        .relative(input.workspaceRoot, p)
        .split(path.sep)
        .join("/");

    // --- workspace.json ----------------------------------------------------
    try {
      const identityPath = path.join(aifetchlyDir, WORKSPACE_JSON);
      const st = await fsp.lstat(identityPath);
      if (st.isSymbolicLink()) {
        diagnostics.push(
          diagnostic(
            input.sourceId,
            rel(identityPath),
            "memory-symlink-rejected",
            "workspace identity is a symbolic link; ignored"
          )
        );
      } else if (st.isFile() && st.size <= MAX_IDENTITY_BYTES) {
        const buf = await fsp.readFile(identityPath);
        const text = decodeStrictUtf8(buf);
        if (text === null) {
          diagnostics.push(
            diagnostic(
              input.sourceId,
              rel(identityPath),
              "workspace-identity-invalid",
              "workspace identity is not valid UTF-8"
            )
          );
        } else {
          let raw: unknown = null;
          try {
            raw = JSON.parse(text);
          } catch {
            raw = null;
          }
          identity = {
            relativePath: ".aifetchly/workspace.json",
            raw,
            contentHash: sha256(buf),
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
          };
        }
      }
    } catch {
      // Missing identity file is the normal pre-enable state.
    }

    // --- memory directory ----------------------------------------------------
    let entries: fs.Dirent[];
    try {
      const dirSt = await fsp.stat(memoryDir);
      if (!dirSt.isDirectory()) {
        return emptySnapshot(false, diagnostics, identity);
      }
      directoryPresent = true;
      entries = await fsp.readdir(memoryDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Missing directory = disabled/empty portable memory (normal).
        return emptySnapshot(false, diagnostics, identity);
      }
      // Enumeration failed for another reason: the scan is INCOMPLETE.
      diagnostics.push(
        diagnostic(
          input.sourceId,
          `${AIFETCHLY_DIR}/${MEMORY_DIR}`,
          "memory-scan-incomplete",
          "failed to enumerate the memory directory"
        )
      );
      return {
        ...emptySnapshot(false, diagnostics, identity),
        complete: false,
      };
    }

    const candidates: { readonly name: string; readonly full: string }[] = [];
    for (const entry of entries) {
      const full = path.join(memoryDir, entry.name);
      // Atomic-write temp files are pure churn: never observed, never
      // imported, never reconciled as deletions (design §12.1).
      if (isAtomicTempName(entry.name)) continue;
      const relative = rel(full);
      seenRelativePaths.push(relative);
      if (entry.isDirectory()) {
        diagnostics.push(
          diagnostic(
            input.sourceId,
            relative,
            "memory-content-invalid",
            "subdirectories are not supported in the memory directory"
          )
        );
        continue;
      }
      if (entry.isSymbolicLink()) {
        diagnostics.push(
          diagnostic(
            input.sourceId,
            relative,
            "memory-symlink-rejected",
            "symbolic links are not supported"
          )
        );
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === README_MD) {
        readmeHash = await hashFileQuietly(full);
        continue;
      }
      if (entry.name === INDEX_MD) {
        indexHash = await hashFileQuietly(full);
        continue;
      }
      if (!entry.name.endsWith(".md")) {
        diagnostics.push(
          diagnostic(
            input.sourceId,
            relative,
            "memory-content-invalid",
            "only .md record files are supported"
          )
        );
        continue;
      }
      if (candidates.length >= PORTABLE_MEMORY_LIMITS.maxRecordsPerWorkspace) {
        diagnostics.push(
          diagnostic(
            input.sourceId,
            relative,
            "memory-count-cap",
            `memory record count exceeds ${PORTABLE_MEMORY_LIMITS.maxRecordsPerWorkspace}`
          )
        );
        continue;
      }
      candidates.push({ name: entry.name, full });
    }

    candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    // Bounded concurrency (§12.2.9): process in chunks of 8.
    for (
      let i = 0;
      i < candidates.length;
      i += PORTABLE_MEMORY_LIMITS.workerConcurrency
    ) {
      const chunk = candidates.slice(
        i,
        i + PORTABLE_MEMORY_LIMITS.workerConcurrency
      );
      const drafts = await Promise.all(
        chunk.map((c) => this.readCandidate(c, input.sourceId, rel))
      );
      for (const d of drafts) {
        if (
          d.diagnostics.some((diag) => diag.code === "memory-scan-incomplete")
        ) {
          complete = false;
        }
        totalBytes += d.draft.sizeBytes;
        if (totalBytes > PORTABLE_MEMORY_LIMITS.maxTotalScanBytes) {
          diagnostics.push(
            diagnostic(
              input.sourceId,
              d.draft.relativePath,
              "memory-count-cap",
              "total memory bytes exceed the 16 MiB scan cap"
            )
          );
          continue;
        }
        diagnostics.push(...d.diagnostics);
        records.push(d.draft);
      }
      if (totalBytes > PORTABLE_MEMORY_LIMITS.maxTotalScanBytes) break;
    }

    return {
      schemaVersion: 1,
      directoryPresent,
      complete,
      ...(identity ? { identity } : {}),
      records,
      seenRelativePaths,
      ...(readmeHash !== undefined ? { readmeHash } : {}),
      ...(indexHash !== undefined ? { indexHash } : {}),
      totalBytes,
      diagnostics,
    };
  }

  private async readCandidate(
    candidate: { readonly name: string; readonly full: string },
    sourceId: string,
    rel: (p: string) => string
  ): Promise<{
    readonly draft: PortableMemoryFileDraft;
    readonly diagnostics: AIFetchlyConfigDiagnostic[];
  }> {
    const relative = rel(candidate.full);
    const none = (code: string, message: string): PortableMemoryFileDraft => ({
      relativePath: relative,
      fileName: candidate.name,
      contentHash: "",
      sizeBytes: 0,
      mtimeMs: 0,
      rawFrontmatter: null,
      markdownBody: "",
      isSymbolicLink: false,
    });
    try {
      // lstat before read + size cap (§12.2.8).
      const st = await fsp.lstat(candidate.full);
      if (st.isSymbolicLink()) {
        return {
          draft: { ...none("", ""), isSymbolicLink: true },
          diagnostics: [
            diagnostic(
              sourceId,
              relative,
              "memory-symlink-rejected",
              "symbolic links are not supported"
            ),
          ],
        };
      }
      if (st.size > PORTABLE_MEMORY_LIMITS.maxFileBytes) {
        return {
          draft: { ...none("", ""), sizeBytes: st.size, mtimeMs: st.mtimeMs },
          diagnostics: [
            diagnostic(
              sourceId,
              relative,
              "memory-file-too-large",
              `record exceeds ${PORTABLE_MEMORY_LIMITS.maxFileBytes} bytes`
            ),
          ],
        };
      }
      const buf = await fsp.readFile(candidate.full);
      const hash = sha256(buf);
      const text = decodeStrictUtf8(buf);
      if (text === null) {
        return {
          draft: {
            ...none("", ""),
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
            contentHash: hash,
          },
          diagnostics: [
            diagnostic(
              sourceId,
              relative,
              "memory-content-invalid",
              "record is not valid UTF-8"
            ),
          ],
        };
      }
      const split = splitFrontmatter(text);
      return {
        draft: {
          relativePath: relative,
          fileName: candidate.name,
          contentHash: hash,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          rawFrontmatter: split.raw,
          markdownBody: split.body,
          ...(split.error !== undefined ? { syntaxError: split.error } : {}),
          isSymbolicLink: false,
        },
        diagnostics: [],
      };
    } catch {
      // Read failure on a candidate that enumeration saw: the scan cannot be
      // considered complete (main must not reconcile deletions).
      return {
        draft: none("memory-scan-incomplete", `failed to read ${relative}`),
        diagnostics: [
          diagnostic(
            sourceId,
            relative,
            "memory-scan-incomplete",
            "failed to read record file"
          ),
        ],
      };
    }
  }
}

function emptySnapshot(
  directoryPresent: boolean,
  diagnostics: AIFetchlyConfigDiagnostic[],
  identity?: PortableWorkspaceIdentityDraft
): PortableMemoryScanSnapshot {
  return {
    schemaVersion: 1,
    directoryPresent,
    complete: true,
    ...(identity ? { identity } : {}),
    records: [],
    seenRelativePaths: [],
    totalBytes: 0,
    diagnostics,
  };
}

async function hashFileQuietly(full: string): Promise<string | undefined> {
  try {
    const buf = await fsp.readFile(full);
    return sha256(buf);
  } catch {
    return undefined;
  }
}

function isAtomicTempName(name: string): boolean {
  return /(^|\.)tmp$/.test(name) || /\.bak$/i.test(name) || /^\./.test(name);
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
