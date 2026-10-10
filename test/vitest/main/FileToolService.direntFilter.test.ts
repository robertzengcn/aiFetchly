/**
 * Regression tests for the file_read "File not found on an existing file"
 * bug on Windows reparse points.
 *
 * On Windows, `fs.readdirSync(parent, { withFileTypes: true })` returns Dirent
 * entries whose type is derived from the directory entry's attributes. Files
 * carrying a non-symlink reparse point (OneDrive/Dropbox cloud placeholders,
 * backup/mirror markers) report `isFile() === false` AND `isSymbolicLink() ===
 * false`. The old candidate filter `isFile() || isSymbolicLink()` dropped them,
 * so `matchExistingFileName` never saw the file and file_read returned a bare
 * `File not found: <path>` with no hint — even though `dir /x` proved the file
 * existed.
 *
 * These tests mock `fs.readdirSync` (file-level, ESM-safe via vi.mock) to
 * return such an unknown-type Dirent and assert that file_read still succeeds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "os";
import * as path from "path";

// Controllable readdir override holder. `vi.hoisted` runs the factory at
// hoist time (before vi.mock) so the closure can safely reference the holder
// from inside the mocked fs factory. Tests assign `.override` before calling
// the service; the mocked readdirSync delegates to it when set, otherwise
// falls back to the real implementation.
const readdirHolder = vi.hoisted(() => ({
  override: null as ((dir: string, opts: unknown) => unknown[] | void) | null,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readdirSync: ((
      dir: import("fs").PathLike,
      opts?: import("fs").ObjectEncodingOptions | { withFileTypes: boolean }
    ) => {
      if (readdirHolder.override) {
        const result = readdirHolder.override(String(dir), opts);
        if (result) return result;
      }
      return actual.readdirSync(
        dir,
        opts as Parameters<typeof actual.readdirSync>[1]
      );
    }) as typeof actual.readdirSync,
  };
});

import * as fs from "fs";
import { FileToolService } from "@/service/FileToolService";

/** Build a Dirent whose type predicates all return false (Windows reparse point). */
function unknownTypeDirent(name: string): fs.Dirent {
  return {
    name,
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as fs.Dirent;
}

describe("FileToolService dirent filter (Windows reparse points)", () => {
  let service: FileToolService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "fts-dirent-"))
    );
    service = new FileToolService([tmpDir]);
  });

  afterEach(() => {
    readdirHolder.override = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a file whose Dirent isFile() returns false", async () => {
    const filePath = path.join(tmpDir, "softwarecompany_contact_list.csv");
    fs.writeFileSync(filePath, "email,name\na@example.com,Ada\n");

    // Make readdirSync report the target file as an unknown-type entry, while
    // every other entry passes through unchanged.
    readdirHolder.override = (dir, opts) => {
      const withFileTypes =
        typeof opts === "object" &&
        opts !== null &&
        (opts as { withFileTypes?: boolean }).withFileTypes === true;
      if (!withFileTypes) return;
      const real = fs.readdirSync(dir as string, { withFileTypes: true });
      return real.map((entry) =>
        entry.name === "softwarecompany_contact_list.csv"
          ? unknownTypeDirent(entry.name)
          : entry
      );
    };

    const result = await service.execute("file_read", {
      path: "softwarecompany_contact_list.csv",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("a@example.com");
  });

  it("surfaces the OS error code when the folder cannot be read", async () => {
    // The file does not exist; locateReadableFile reaches readdirSync on the
    // parent and the override throws a non-permission errno so we can assert
    // the code is surfaced instead of masked as a bare "File not found".
    const err = new Error("I/O error") as NodeJS.ErrnoException;
    err.code = "EIO";
    readdirHolder.override = () => {
      throw err;
    };

    const result = await service.execute("file_read", {
      path: "definitely_missing_file.csv",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("EIO");
    // Must surface the OS code rather than a bare, code-less "File not found".
    expect(result.error).toContain("(folder read error: EIO)");
  });
});
