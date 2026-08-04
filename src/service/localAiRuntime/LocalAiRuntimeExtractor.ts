/**
 * Local AI Runtime — safe streaming ZIP extraction (design §13).
 *
 * Uses yauzl for lazy, entry-by-entry extraction (runtime archives can exceed
 * 100 MB and contain native executables; adm-zip buffers in memory and is
 * scoped to smaller plugin packages). Every entry is validated before writing:
 *
 * - safe relative path (no traversal / absolute / drive / UNC / NUL / device)
 * - no symlink / hard-link / device / socket entries
 * - no duplicate normalized path
 * - per-entry and aggregate size limits
 * - entry-count limit
 * - resolved output stays beneath the staging root
 *
 * Files are written with conservative modes (0o644, dirs 0o755); the execute
 * bit is preserved only for regular files whose unix mode marks them executable.
 * Archive permission bits are otherwise not trusted.
 */
import { promises as fs, createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import { isSafeRelativeRuntimePath } from "@/schemas/localAiRuntime";
import { LocalAiRuntimeError } from "@/entityTypes/localAiRuntimeTypes";
import { LOCAL_AI_RUNTIME_LIMITS } from "./localAiRuntimeConstants";

export interface ExtractResult {
  entries: string[];
  totalBytes: number;
}

// Unix file type bits (from zip external attributes, high 16 bits).
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFSOCK = 0o140000;
const S_IFBLK = 0o060000;
const S_IFCHR = 0o020000;
const S_IXUSR = 0o100;

/** yauzl entry shape (subset we use). */
interface YauzlEntry {
  fileName: string;
  uncompressedSize: number;
  externalFileAttributes: number;
}

interface YauzlZipFile {
  readEntry(): void;
  openReadStream(
    entry: YauzlEntry,
    cb: (err: Error | null, stream?: Readable) => void
  ): void;
  on(event: "entry", cb: (entry: YauzlEntry) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

function openZip(archivePath: string): Promise<YauzlZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, autoClose: true },
      (err: Error | null, zipfile?: YauzlZipFile) => {
        if (err || !zipfile) {
          reject(
            new LocalAiRuntimeError(
              "runtime_archive_invalid",
              `Failed to open archive: ${err?.message ?? "unknown error"}`
            )
          );
          return;
        }
        resolve(zipfile);
      }
    );
  });
}

function openEntryStream(
  zipfile: YauzlZipFile,
  entry: YauzlEntry
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(
          new LocalAiRuntimeError(
            "runtime_archive_invalid",
            err?.message ?? "read error"
          )
        );
        return;
      }
      resolve(stream);
    });
  });
}

function entryUnixMode(entry: YauzlEntry): number {
  // High 16 bits of external attributes hold the Unix mode (if present).
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

/** Validate a single zip entry's name and type. Exported for direct unit tests. */
export function assertEntrySafe(entry: YauzlEntry): void {
  if (!entry.fileName || entry.fileName.includes("\0")) {
    throw new LocalAiRuntimeError(
      "runtime_archive_unsafe",
      "Empty or NUL-containing entry name."
    );
  }
  // Directory entries end with "/"; validate the directory name without the slash.
  const isDir = entry.fileName.endsWith("/");
  const candidate = isDir ? entry.fileName.slice(0, -1) : entry.fileName;
  if (candidate.length > 0 && !isSafeRelativeRuntimePath(candidate)) {
    throw new LocalAiRuntimeError(
      "runtime_archive_unsafe",
      `Unsafe archive entry path: ${entry.fileName}`
    );
  }
  const mode = entryUnixMode(entry);
  const fileType = mode & S_IFMT;
  if (
    fileType === S_IFLNK ||
    fileType === S_IFSOCK ||
    fileType === S_IFBLK ||
    fileType === S_IFCHR
  ) {
    throw new LocalAiRuntimeError(
      "runtime_archive_unsafe",
      `Rejected special entry type: ${entry.fileName}`
    );
  }
  if (entry.uncompressedSize > LOCAL_AI_RUNTIME_LIMITS.maxSingleEntryBytes) {
    throw new LocalAiRuntimeError(
      "runtime_archive_unsafe",
      `Entry exceeds single-entry size limit: ${entry.fileName}`
    );
  }
}

/**
 * Extract `archivePath` into `stagingRoot` with full entry validation. Resolves
 * with the list of written relative paths and total byte count. Rejects on any
 * unsafe entry, size/count limit, duplicate path, or abort.
 */
export async function extractRuntimeArchive(
  archivePath: string,
  stagingRoot: string,
  signal?: AbortSignal
): Promise<ExtractResult> {
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });

  const resolvedStaging = path.resolve(stagingRoot);
  const seen = new Set<string>();
  const entries: string[] = [];
  let totalBytes = 0;

  const zipfile = await openZip(archivePath);

  return new Promise<ExtractResult>((resolve, reject) => {
    let settled = false;
    const fail = (error: LocalAiRuntimeError): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    zipfile.on("error", (err: Error) => {
      fail(new LocalAiRuntimeError("runtime_archive_invalid", err.message));
    });

    zipfile.on("entry", async (entry: YauzlEntry) => {
      try {
        if (signal?.aborted) {
          throw new LocalAiRuntimeError(
            "runtime_download_cancelled",
            "Extraction cancelled."
          );
        }
        if (entries.length + seen.size >= LOCAL_AI_RUNTIME_LIMITS.maxEntries) {
          throw new LocalAiRuntimeError(
            "runtime_archive_unsafe",
            "Entry count limit exceeded."
          );
        }
        assertEntrySafe(entry);

        const isDir = entry.fileName.endsWith("/");
        const normalized = isDir ? entry.fileName.slice(0, -1) : entry.fileName;
        if (normalized.length > 0) {
          if (seen.has(normalized)) {
            throw new LocalAiRuntimeError(
              "runtime_archive_unsafe",
              `Duplicate archive entry: ${normalized}`
            );
          }
          seen.add(normalized);
        }

        const target = path.resolve(resolvedStaging, normalized);
        const prefix = `${resolvedStaging}${path.sep}`;
        if (
          normalized.length > 0 &&
          target !== resolvedStaging &&
          !target.startsWith(prefix)
        ) {
          throw new LocalAiRuntimeError(
            "runtime_archive_unsafe",
            `Entry escapes staging root: ${entry.fileName}`
          );
        }

        if (
          totalBytes + entry.uncompressedSize >
          LOCAL_AI_RUNTIME_LIMITS.maxExtractedBytes
        ) {
          throw new LocalAiRuntimeError(
            "runtime_archive_unsafe",
            "Aggregate size limit exceeded."
          );
        }

        if (isDir) {
          await fs.mkdir(target, { recursive: true });
          zipfile.readEntry();
          return;
        }

        await fs.mkdir(path.dirname(target), { recursive: true });
        const mode = entryUnixMode(entry);
        const fileMode = (mode & S_IXUSR) !== 0 ? 0o755 : 0o644;

        const stream = await openEntryStream(zipfile, entry);
        // Exclusive create: defense-in-depth against duplicate/conflicting writes.
        const out: WriteStream = createWriteStream(target, {
          flags: "wx",
          mode: fileMode,
        });
        let entryBytes = 0;
        stream.on("data", (chunk: Buffer) => {
          entryBytes += chunk.length;
          totalBytes += chunk.length;
          if (
            entryBytes > LOCAL_AI_RUNTIME_LIMITS.maxSingleEntryBytes ||
            totalBytes > LOCAL_AI_RUNTIME_LIMITS.maxExtractedBytes
          ) {
            stream.destroy(
              new LocalAiRuntimeError(
                "runtime_archive_unsafe",
                "Size limit exceeded during read."
              )
            );
          }
        });
        stream.on("error", (err: Error) => {
          out.destroy();
          fail(
            err instanceof LocalAiRuntimeError
              ? err
              : new LocalAiRuntimeError("runtime_archive_invalid", err.message)
          );
        });
        out.on("error", (err: Error) => {
          stream.destroy();
          fail(new LocalAiRuntimeError("runtime_archive_invalid", err.message));
        });
        out.on("close", () => {
          entries.push(normalized);
          if (!settled) zipfile.readEntry();
        });
        stream.pipe(out);
      } catch (error) {
        fail(
          error instanceof LocalAiRuntimeError
            ? error
            : new LocalAiRuntimeError(
                "runtime_archive_invalid",
                (error as Error).message
              )
        );
      }
    });

    zipfile.on("close", () => {
      if (settled) return;
      settled = true;
      resolve({ entries, totalBytes });
    });

    zipfile.readEntry();
  });
}

/**
 * Post-extraction validation of identity, target, and required files against the
 * catalog entry (design §13.2 / FR-7). The package manifest is read from the
 * extracted root, validated, and compared to the catalog identity; platform and
 * architecture must match the running process.
 */
export interface ExtractedPackageValidation {
  ok: true;
  manifest: import("@/entityTypes/localAiRuntimeTypes").LocalAiRuntimePackageManifest;
  totalBytes: number;
}
export interface ExtractedPackageFailure {
  ok: false;
  code: import("@/entityTypes/localAiRuntimeTypes").LocalAiRuntimeErrorCode;
  message: string;
}

export async function validateExtractedPackage(
  stagingRoot: string,
  catalogEntry: import("@/entityTypes/localAiRuntimeTypes").LocalAiRuntimeCatalogEntry,
  target: import("@/entityTypes/localAiRuntimeTypes").LocalAiRuntimeTarget,
  totalBytes: number
): Promise<ExtractedPackageValidation | ExtractedPackageFailure> {
  const { localAiRuntimePackageManifestSchema } = await import(
    "@/schemas/localAiRuntime"
  );
  const manifestPath = path.join(stagingRoot, "manifest.json");
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    return {
      ok: false,
      code: "runtime_manifest_invalid",
      message: "manifest.json missing",
    };
  }
  const parsed = localAiRuntimePackageManifestSchema.safeParse(
    JSON.parse(raw) as unknown
  );
  if (!parsed.success) {
    return {
      ok: false,
      code: "runtime_manifest_invalid",
      message: "manifest.json invalid",
    };
  }
  const manifest = parsed.data;

  // Identity must match the catalog exactly; the package cannot broaden it.
  if (
    manifest.runtimeId !== catalogEntry.runtimeId ||
    manifest.runtimeVersion !== catalogEntry.runtimeVersion ||
    manifest.platform !== catalogEntry.platform ||
    manifest.arch !== catalogEntry.arch ||
    manifest.nodeModuleAbi !== catalogEntry.nodeModuleAbi
  ) {
    return {
      ok: false,
      code: "runtime_manifest_invalid",
      message: "manifest/catalog identity mismatch",
    };
  }
  // Native target must match the running process.
  if (manifest.platform !== target.platform || manifest.arch !== target.arch) {
    return {
      ok: false,
      code: "runtime_incompatible",
      message: "extracted target mismatch",
    };
  }
  // Required files must all be present.
  for (const required of manifest.requiredFiles) {
    try {
      await fs.access(path.join(stagingRoot, required));
    } catch {
      return {
        ok: false,
        code: "runtime_required_file_missing",
        message: `missing required file: ${required}`,
      };
    }
  }
  if (totalBytes > LOCAL_AI_RUNTIME_LIMITS.maxExtractedBytes) {
    return {
      ok: false,
      code: "runtime_archive_unsafe",
      message: "expanded size exceeds limit",
    };
  }
  return { ok: true, manifest, totalBytes };
}
