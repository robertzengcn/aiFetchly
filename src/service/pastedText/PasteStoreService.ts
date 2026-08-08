import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import writeFileAtomic from "write-file-atomic";

/**
 * Content-addressed on-disk store for expanded pasted-text bodies.
 *
 * Keyed by the first 16 hex chars of sha256(content) so we keep filenames
 * short while still being robust enough for a local cache.
 */

const PASTE_CACHE_DIR_NAME = "paste-cache";
const PASTE_CACHE_HASH_PREFIX_LEN = 16;
const PASTE_CACHE_VALID_HASH_RE = /^[a-f0-9]{16}$/;

function sha256HexPrefix(content: string): string {
  const full = createHash("sha256").update(content, "utf8").digest("hex");
  return full.slice(0, PASTE_CACHE_HASH_PREFIX_LEN);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Best-effort bulk delete: unlinks each entry concurrently, swallowing
 * per-file errors so one failure (e.g. a concurrently-removed file) doesn't
 * abort the rest of cleanup. Awaited so callers see deletions completed.
 */
async function deleteEntries(
  cacheRoot: string,
  toDelete: ReadonlyArray<{ name: string }>
): Promise<void> {
  await Promise.all(
    toDelete.map(async (e) => {
      try {
        await fs.unlink(path.join(cacheRoot, e.name));
      } catch {
        // ignore: best-effort cleanup
      }
    })
  );
}

export class PasteStoreService {
  constructor(private readonly cacheRoot?: string) {}

  private resolveCacheRoot(): string {
    if (this.cacheRoot) return this.cacheRoot;
    // Import Electron only when we actually need the default location.
    // This keeps the class easier to unit test by injecting cacheRoot.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as typeof import("electron");
    return path.join(electron.app.getPath("userData"), PASTE_CACHE_DIR_NAME);
  }

  private pastePath(hashPrefix: string): string {
    return path.join(this.resolveCacheRoot(), `${hashPrefix}.txt`);
  }

  async write(content: string): Promise<string> {
    const hashPrefix = sha256HexPrefix(content);
    await ensureDir(this.resolveCacheRoot());
    await writeFileAtomic(this.pastePath(hashPrefix), content, {
      encoding: "utf8",
      mode: 0o600,
    });
    return hashPrefix;
  }

  async read(contentHash: string): Promise<string | null> {
    if (!PASTE_CACHE_VALID_HASH_RE.test(contentHash)) return null;
    try {
      return await fs.readFile(this.pastePath(contentHash), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Best-effort local cleanup:
   * - delete files older than maxAgeDays
   * - then enforce maxFiles by deleting oldest remaining files
   */
  async cleanupOldPastes(maxAgeDays = 30, maxFiles = 500): Promise<void> {
    const cacheRoot = this.resolveCacheRoot();
    const entries: Array<{
      name: string;
      mtimeMs: number;
      hashPrefix: string;
    }> = [];

    try {
      const dirents = await fs.readdir(cacheRoot, { withFileTypes: true });
      for (const d of dirents) {
        if (!d.isFile()) continue;
        const match = /^([a-f0-9]{16})\.txt$/i.exec(d.name);
        if (!match) continue;
        const hashPrefix = match[1].toLowerCase();
        if (!PASTE_CACHE_VALID_HASH_RE.test(hashPrefix)) continue;
        const fullPath = path.join(cacheRoot, d.name);
        const stat = await fs.stat(fullPath);
        entries.push({ name: d.name, mtimeMs: stat.mtimeMs, hashPrefix });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return; // cache root doesn't exist yet
      throw err;
    }

    const now = Date.now();
    const maxAgeMs = Math.max(0, maxAgeDays) * 24 * 60 * 60 * 1000;

    const survivors: typeof entries = [];
    const agedOut: typeof entries = [];
    for (const e of entries) {
      if (maxAgeMs > 0 && now - e.mtimeMs > maxAgeMs) {
        agedOut.push(e);
      } else {
        survivors.push(e);
      }
    }
    await deleteEntries(cacheRoot, agedOut);

    if (survivors.length <= maxFiles) return;

    survivors.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    const toDelete = survivors.slice(
      0,
      Math.max(0, survivors.length - maxFiles)
    );
    await deleteEntries(cacheRoot, toDelete);
  }
}
