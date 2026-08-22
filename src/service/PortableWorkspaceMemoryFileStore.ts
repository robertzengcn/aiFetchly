/**
 * PortableWorkspaceMemoryFileStore — the ONLY module allowed to touch
 * portable-memory files on disk (design §15).
 *
 * Path safety model:
 *   - Constructed internally from a trusted canonical workspace root plus a
 *     memory id / fixed file name — a renderer never supplies a path.
 *   - Every target's parent real path must resolve inside
 *     `<root>/.aifetchly/memory` (or `<root>/.aifetchly` for workspace.json).
 *   - Symbolic links are rejected via lstat before read/write/delete.
 *   - Null bytes and separator tricks in ids are rejected up front.
 *
 * Writes go through `write-file-atomic` (temp file in the same directory +
 * rename) so a crash leaves either the old or the new complete file (D-06).
 */

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import writeFileAtomic from "write-file-atomic";
import type { PortableWorkspaceIdentityV1 } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { PORTABLE_MEMORY_ID_PATTERN } from "@/entityTypes/portableWorkspaceMemoryTypes";

const AIFETCHLY_DIR = ".aifetchly";
const MEMORY_DIR = "memory";
const WORKSPACE_JSON = "workspace.json";
const INDEX_MD = "INDEX.md";
const README_MD = "README.md";

export interface PortableWriteResult {
  readonly contentHash: string;
  readonly sizeBytes: number;
}

export interface PortableFileContent {
  readonly content: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

export class PortableWorkspaceMemoryFileStore {
  private readonly root: string;

  constructor(canonicalWorkspaceRoot: string) {
    this.root = canonicalWorkspaceRoot;
  }

  // --- Path construction ---------------------------------------------------

  /** `.aifetchly/memory` absolute path (native separators). */
  memoryDir(): string {
    return path.join(this.root, AIFETCHLY_DIR, MEMORY_DIR);
  }

  /** `.aifetchly/workspace.json` absolute path. */
  identityPath(): string {
    return path.join(this.root, AIFETCHLY_DIR, WORKSPACE_JSON);
  }

  indexPath(): string {
    return path.join(this.memoryDir(), INDEX_MD);
  }

  readmePath(): string {
    return path.join(this.memoryDir(), README_MD);
  }

  /** POSIX-style relative path used in SQLite/IPC. */
  static relativePathForMemoryId(memoryId: string): string {
    return `${AIFETCHLY_DIR}/${MEMORY_DIR}/${memoryId}.md`;
  }

  private recordPath(memoryId: string): string {
    if (!PORTABLE_MEMORY_ID_PATTERN.test(memoryId)) {
      throw new Error("Invalid portable memory id");
    }
    if (memoryId.includes("/") || memoryId.includes("\\")) {
      throw new Error("Invalid portable memory id");
    }
    return path.join(this.memoryDir(), `${memoryId}.md`);
  }

  /**
   * Containment + symlink check. The resolved real parent directory must be
   * the expected directory, and the target itself must not be a symlink.
   */
  private async assertSafeTarget(
    target: string,
    expectedDir: string
  ): Promise<void> {
    const parent = path.dirname(target);
    const realParent = await fsp.realpath(parent);
    const realExpected = await fsp.realpath(expectedDir);
    if (realParent !== realExpected) {
      throw new Error("portable memory path escapes the approved directory");
    }
    try {
      const st = await fsp.lstat(target);
      if (st.isSymbolicLink()) {
        throw new Error("symbolic links are rejected in portable memory paths");
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // --- Record files ----------------------------------------------------------

  async writeRecord(
    memoryId: string,
    content: string
  ): Promise<PortableWriteResult> {
    const target = this.recordPath(memoryId);
    await this.ensureMemoryDir();
    await this.assertSafeTarget(target, this.memoryDir());
    await writeFileAtomic(target, content, "utf8");
    return {
      contentHash: sha256(content),
      sizeBytes: Buffer.byteLength(content, "utf8"),
    };
  }

  async readRecord(memoryId: string): Promise<PortableFileContent | null> {
    const target = this.recordPath(memoryId);
    try {
      await this.assertSafeTarget(target, this.memoryDir());
      const st = await fsp.stat(target);
      const content = await fsp.readFile(target, "utf8");
      return {
        content,
        contentHash: sha256(content),
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** Hash-only probe used for conflict detection (never returns content). */
  async hashRecord(memoryId: string): Promise<string | null> {
    const r = await this.readRecord(memoryId);
    return r?.contentHash ?? null;
  }

  async deleteRecord(memoryId: string): Promise<boolean> {
    const target = this.recordPath(memoryId);
    try {
      await this.assertSafeTarget(target, this.memoryDir());
      await fsp.unlink(target);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  // --- Index / README --------------------------------------------------------

  async writeIndex(content: string): Promise<PortableWriteResult> {
    const target = this.indexPath();
    await this.ensureMemoryDir();
    await this.assertSafeTarget(target, this.memoryDir());
    await writeFileAtomic(target, content, "utf8");
    return {
      contentHash: sha256(content),
      sizeBytes: Buffer.byteLength(content, "utf8"),
    };
  }

  async readIndexHash(): Promise<string | null> {
    return this.readFileHash(this.indexPath());
  }

  async writeReadme(content: string): Promise<PortableWriteResult> {
    const target = this.readmePath();
    await this.ensureMemoryDir();
    await this.assertSafeTarget(target, this.memoryDir());
    await writeFileAtomic(target, content, "utf8");
    return {
      contentHash: sha256(content),
      sizeBytes: Buffer.byteLength(content, "utf8"),
    };
  }

  async readReadme(): Promise<string | null> {
    try {
      return await fsp.readFile(this.readmePath(), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  // --- workspace.json ----------------------------------------------------------

  async writeIdentity(identity: PortableWorkspaceIdentityV1): Promise<void> {
    const dir = path.join(this.root, AIFETCHLY_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const target = this.identityPath();
    await this.assertSafeTarget(target, dir);
    const content = `${JSON.stringify(identity, null, 2)}\n`;
    await writeFileAtomic(target, content, "utf8");
  }

  async readIdentityFile(): Promise<{
    readonly raw: string;
    readonly contentHash: string;
  } | null> {
    try {
      const dir = path.join(this.root, AIFETCHLY_DIR);
      await this.assertSafeTarget(this.identityPath(), dir);
      const raw = await fsp.readFile(this.identityPath(), "utf8");
      return { raw, contentHash: sha256(raw) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  // --- Directory state ---------------------------------------------------------

  async ensureMemoryDir(): Promise<void> {
    await fsp.mkdir(this.memoryDir(), { recursive: true });
  }

  async memoryDirExists(): Promise<boolean> {
    try {
      const st = await fsp.stat(this.memoryDir());
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Cleanup of stale atomic-write temp files (startup recovery, design
   * §22.3). Only removes files matching write-file-atomic's temp pattern and
   * older than 24h — never arbitrary user files.
   */
  async cleanupStaleTempFiles(
    olderThanMs = 24 * 60 * 60 * 1000,
    now = Date.now()
  ): Promise<number> {
    if (!(await this.memoryDirExists())) return 0;
    const entries = await fsp.readdir(this.memoryDir());
    let removed = 0;
    for (const name of entries) {
      if (!isAtomicTempFileName(name)) continue;
      const full = path.join(this.memoryDir(), name);
      try {
        const st = await fsp.stat(full);
        if (now - st.mtimeMs > olderThanMs) {
          await fsp.unlink(full);
          removed += 1;
        }
      } catch {
        // raced away — ignore
      }
    }
    return removed;
  }

  private async readFileHash(target: string): Promise<string | null> {
    try {
      const content = await fsp.readFile(target, "utf8");
      return sha256(content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

/**
 * write-file-atomic's default temp naming: `<file>.<pid>-<random>.tmp`-style
 * suffixes ending in `.tmp` (plus the conventional `.bak` backups some
 * editors leave behind).
 */
export function isAtomicTempFileName(name: string): boolean {
  return /(^|\.)tmp$/.test(name) || /\.bak$/i.test(name) || /^\./.test(name);
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Re-export for tests that need fs-level assertions.
export const fsSync = fs;
