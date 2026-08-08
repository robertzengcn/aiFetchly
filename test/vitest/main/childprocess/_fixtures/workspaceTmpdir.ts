/**
 * Shared test fixtures for the workspace watcher stack.
 *
 * Used by WorkspaceConfigScanner.test.ts, WorkspaceChokidarWatcher.debounce.test.ts,
 * and rescanSla.test.ts. Centralised here so the three test files build identical
 * fixture trees (the SC5 SLA definition references the same ≤10 files / ≤512KB
 * typical-shape contract).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Create a unique tmpdir for a test workspace. Returns the workspace root
 * (no `.aifetchly` created — tests opt in via writeFiles).
 */
export function tmpdirSync(prefix = "af-ws-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface FixtureFile {
  /** Path relative to the workspace root, e.g. ".aifetchly/AGENTS.md". */
  readonly path: string;
  /** Exact content. Mutually exclusive with `size`. */
  readonly content?: string;
  /** Generate `size` bytes of repeating filler content. Mutually exclusive with `content`. */
  readonly size?: number;
}

/**
 * Write a fixture tree under `root`. Creates intermediate directories as
 * needed (including the `.aifetchly` dir). Idempotent per file path.
 */
export function writeFiles(root: string, files: readonly FixtureFile[]): void {
  for (const f of files) {
    const abs = path.join(root, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (f.content !== undefined) {
      fs.writeFileSync(abs, f.content, "utf8");
    } else if (f.size !== undefined) {
      // Repeat a printable ASCII byte pattern to avoid fs sync quirks with
      // long runs of NUL; the SHA differs by file size, which is what tests
      // need to assert.
      const chunk = "a".repeat(1024);
      const buf = Buffer.alloc(f.size);
      for (let i = 0; i < f.size; i += chunk.length) {
        buf.write(chunk, i, Math.min(chunk.length, f.size - i), "utf8");
      }
      fs.writeFileSync(abs, buf);
    } else {
      throw new Error(`fixture file ${f.path} needs content or size`);
    }
  }
}

/** Helper: read a workspace-relative file as utf-8 string (test assertions). */
export function readFile(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
