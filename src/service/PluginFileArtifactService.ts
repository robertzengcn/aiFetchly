import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { log } from "@/modules/Logger";
import { getElectronUserDataPath } from "@/service/SkillEnvironmentManager";
import { Token } from "@/modules/token";
import { USERID } from "@/config/usersetting";

/**
 * PluginFileArtifactService — host-owned file-artifact store (HOST-17,
 * design §13).
 *
 * Layout under `<userData>/plugin-artifacts/<scope>/`:
 *   staging/<execution-id>/    plugin-writable per-job staging (candidates)
 *   artifacts/<artifact-id>/   immutable host-owned promoted artifacts
 *     content.json | content.csv
 *     metadata.json            written by the host only
 *   journal/<execution-id>.json  lifecycle/registration journal
 *
 * The plugin writes ONLY inside its staging directory. The host validates
 * candidate files (canonical containment, regular file, no symlinks, allowed
 * extension, size caps, JSON record recount), copies them into fresh
 * host-owned files, and assigns opaque artifact ids. Ownership metadata is
 * host-authoritative; a request id is a reference, never authorization.
 *
 * v1 uses JSON files only — no new database entity (PRD §11 no Yellow Pages
 * persistence).
 */

export type PluginArtifactFormat = "json" | "csv";

export interface PluginArtifactCandidate {
  readonly version: 1;
  /** Fixed v1 filenames the plugin may finalize (design §13.2). */
  readonly relativePath: "records.json" | "records.csv";
  readonly format: PluginArtifactFormat;
  readonly recordCount: number;
  readonly complete: boolean;
}

export interface RegisteredPluginArtifact {
  readonly id: string;
  readonly format: PluginArtifactFormat;
  readonly recordCount: number;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly conversationId: string;
  readonly pluginName: string;
  /** Host-computed sha256 of the promoted content bytes (design §13.2). */
  readonly digest?: string;
  // G03 identity + state ("required schema/user/job/plugin-version/
  // generation identity, MIME, checksum and completion status"):
  /** Metadata schema version (this layout: 1). */
  readonly schemaVersion: 1;
  /** Producing execution id (H1 — the registry job id and journal key). */
  readonly executionId: string;
  /** Host MIME type of the content file. */
  readonly mimeType: string;
  /** Hashed account scope the artifact belongs to (never the raw user id). */
  readonly userScopeId: string;
  /** Completion state of the producing tool call. */
  readonly status: PluginArtifactStatus;
  /** Plugin manifest version / generation at promotion time (G02/G03). */
  readonly pluginVersion?: string;
  readonly pluginGeneration?: string;
}

export type PluginArtifactStatus =
  | "complete" // tool call settled with usable artifacts
  | "degraded" // promotion produced failures or the call failed on the record path
  | "interrupted"; // crashed / host-restart salvage, honest unresolved state

export const PLUGIN_ARTIFACT_LIMITS = {
  /** Max bytes of one finalized artifact file. */
  maxArtifactBytes: 100 * 1024 * 1024,
  /** Max finalized artifacts per execution. */
  maxArtifactsPerExecution: 2,
  /** Default retention for unexported completed artifacts. */
  defaultRetentionMs: 30 * 24 * 60 * 60_000,
  /** Max bytes of a candidates.json manifest read by the host (B10). */
  maxCandidatesManifestBytes: 1024 * 1024,
  /** Hard byte cap for a rendered preview envelope (B01). */
  maxPreviewBytes: 16 * 1024,
  /** Bounded input slice a preview may read/parse (B01). */
  maxPreviewReadBytes: 1024 * 1024,
  // G03 quotas:
  /** Byte quota for the whole per-scope (per-user account) artifact store. */
  maxStoreBytes: 512 * 1024 * 1024,
  /** Byte quota for one plugin inside a scope's store. */
  maxPluginStoreBytes: 256 * 1024 * 1024,
  /** Free-disk cushion that must REMAIN after a promotion succeeds. */
  minFreeDiskBytes: 128 * 1024 * 1024,
  /** Chunk size for streaming validation/digest scans (bounded memory). */
  scanChunkBytes: 1024 * 1024,
  /** Retention applied to a plugin's artifacts after it is uninstalled. */
  pluginUninstallRetentionMs: 7 * 24 * 60 * 60_000,
} as const;

/** Quota preflight failure categories (G03). */
export type PluginArtifactQuotaCode =
  | "STORE_QUOTA"
  | "PLUGIN_QUOTA"
  | "DISK_SPACE";

export type PluginArtifactQuotaCheck =
  | { ok: true; storeUsageBytes: number; pluginUsageBytes: number; freeDiskBytes: number | null }
  | { ok: false; code: PluginArtifactQuotaCode; error: string };

export type PluginArtifactQuotaCheckInput = {
  readonly pluginName: string;
  /** Bytes about to be admitted (staging/manifests/candidate size). */
  readonly incomingBytes?: number;
};

/** Injectable limit overrides (tests); runtime callers get shipped defaults. */
export type PluginArtifactLimitsOverrides = Partial<typeof PLUGIN_ARTIFACT_LIMITS>;

/** Flattened execution-journal state surfaced to the conversation UI (G03). */
export interface PluginExecutionJournalState {
  readonly executionId: string;
  /** running | degraded | interrupted | complete | failed. */
  readonly status: string;
  /** ISO timestamp of the LAST journal write, when readable. */
  readonly at: string | null;
  readonly conversationId: string | null;
  readonly pluginName: string | null;
  readonly registeredCount: number;
  /** Human-agnostic diagnostic note (bounded). */
  readonly message: string | null;
}

/** Structural fs seam for tests. */
export interface ArtifactFs {
  existsSync(p: string): boolean;
  statSync(p: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    /** Hard-link count when the underlying fs exposes it (real fs does). */
    nlink?: number;
    /** Modification time for retention sweeps (real fs). */
    mtimeMs?: number;
  };
  lstatSync(p: string): { isFile(): boolean; isSymbolicLink(): boolean };
  realpathSync(p: string): string;
  mkdirSync(p: string, options?: { recursive: boolean }): string | undefined;
  readdirSync(p: string): string[];
  copyFileSync(from: string, to: string): void;
  writeFileSync(p: string, data: string, options?: { mode: number }): void;
  readFileSync(p: string): string;
  /** Byte read used for digest computation and bounded parses. */
  readBufferSync(p: string): Buffer;
  /** Bounded positional read: at most `end` bytes of `p` (B01 previews). */
  readBufferSliceSync(p: string, end: number): Buffer;
  unlinkSync(p: string): void;
  rmSync(p: string, options?: { recursive: boolean; force: boolean }): void;
  renameSync(from: string, to: string): void;
  /**
   * G03 bounded positional read used by streaming validation/digest scans:
   * reads at most `length` bytes starting at `position` (never the whole
   * file). An empty Buffer means EOF.
   */
  readChunkAtSync(p: string, position: number, length: number): Buffer;
  /**
   * G03 free-space probe (Node ≥ 18.15 fs.statfsSync). Optional: tests and
   * platforms without it skip the disk-space check.
   */
  statfsSync?: (p: string) => { bsize: number; bavail: number };
}

function defaultFs(): ArtifactFs {
  // B01: an EXPLICIT adapter — the previous `{...fs} as ArtifactFs` cast
  // promised `readFileSync(): string` while Node (without encoding) returns
  // a Buffer, which broke real CSV previews (`text.split is not a function`).
  // The strings read here are always decoded as UTF-8.
  return {
    existsSync: (p) => fs.existsSync(p),
    statSync: (p) => fs.statSync(p),
    lstatSync: (p) => fs.lstatSync(p),
    realpathSync: (p) => fs.realpathSync(p),
    mkdirSync: (p, options) => fs.mkdirSync(p, options),
    readdirSync: (p) => fs.readdirSync(p),
    copyFileSync: (from, to) => fs.copyFileSync(from, to),
    writeFileSync: (p, data, options) => fs.writeFileSync(p, data, options),
    readFileSync: (p) => fs.readFileSync(p, "utf8"),
    readBufferSync: (p) => fs.readFileSync(p),
    readBufferSliceSync: (p, end) => {
      // Positional bounded read: never loads a whole 100 MiB artifact into
      // memory just to preview its first rows.
      const fd = fs.openSync(p, "r");
      try {
        const buffer = Buffer.alloc(Math.max(0, end));
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    },
    unlinkSync: (p) => fs.unlinkSync(p),
    rmSync: (p, options) => fs.rmSync(p, options),
    renameSync: (from, to) => fs.renameSync(from, to),
    readChunkAtSync: (p, position, length) => {
      const fd = fs.openSync(p, "r");
      try {
        const buffer = Buffer.alloc(Math.max(0, length));
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, position);
        return buffer.subarray(0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    },
    // statfsSync landed in Node 18.15 but is missing from this project's
    // @types/node version — probe through a typed view instead of relying
    // on the ambient declaration.
    ...(((): { statfsSync?: (p: string) => { bsize: number; bavail: number } } => {
      const runtimeFs = fs as unknown as {
        statfsSync?: (p: string) => { bsize: number; bavail: number };
      };
      return typeof runtimeFs.statfsSync === "function"
        ? { statfsSync: (p: string) => runtimeFs.statfsSync?.(p) as { bsize: number; bavail: number } }
        : {};
    })()),
  };
}

/** Leading characters Excel/Sheets treat as formula-like (design §13.3). */
const CSV_RISKY_LEADING_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Parse a v1 plugin CSV document (RFC 4180 comma-delimited) and verify the
 * spreadsheet-safe export policy at the host boundary (B10): risky leading
 * cells (unquoted or quoted) are rejected, malformed CSV fails, and the
 * count of parsed data records (all logical records minus the fixed header)
 * is returned for verification against the plugin's claim.
 */
export function validatePluginArtifactCsvText(
  text: string
): { ok: true; dataRecords: number } | { ok: false; error: string } {
  const state = new CsvArtifactValidationState();
  state.consume(text);
  return state.finish();
}

/**
 * G03 streaming CSV validator: the SAME RFC-4180 walk as
 * `validatePluginArtifactCsvText`, but fed in bounded chunks so a 100 MiB
 * artifact never needs a full-file buffer or a `toString` copy on the
 * Electron main thread.
 */
export class CsvArtifactValidationState {
  private logicalRecords = 0;
  private recordHasContent = false;
  private inQuotes = false;
  /** True between the opening quote and the first quoted content char. */
  private insideOpeningQuote = false;
  /** True immediately after a closing quote (RFC 4180 delimiter must follow). */
  private afterClosingQuote = false;
  private atCellStart = true;
  /** Set once validation fails; further input is ignored. */
  private failure: string | null = null;
  private bomSkipped = false;
  /** True when the previous chunk ended with a bare `\r` (CRLF may continue). */
  private bareCrCarried = false;

  public get failed(): boolean {
    return this.failure !== null;
  }

  public consume(text: string): void {
    if (text.length === 0 || this.failure !== null) return;
    let chunk = text;
    if (!this.bomSkipped) {
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      this.bomSkipped = true;
      if (chunk.length === 0) return;
    }
    if (this.bareCrCarried) {
      this.bareCrCarried = false;
      if (chunk.charCodeAt(0) === 0x0a) {
        // CRLF pair completed across the chunk boundary — skip the `\n`.
        chunk = chunk.slice(1);
        if (chunk.length === 0) return;
      }
    }
    let i = 0;
    while (i < chunk.length) {
      const ch = chunk[i];
      if (this.inQuotes) {
        if (this.insideOpeningQuote) {
          this.insideOpeningQuote = false;
          if (CSV_RISKY_LEADING_CHARS.has(ch)) {
            this.failure =
              "spreadsheet-formula-like cell (must be neutralized by the plugin)";
            return;
          }
        }
        if (ch === '"') {
          if (chunk[i + 1] === '"') {
            i += 2;
            continue;
          }
          this.inQuotes = false;
          this.afterClosingQuote = true;
          i += 1;
          continue;
        }
        this.recordHasContent = true;
        if (ch === "\r" && chunk[i + 1] === "\n") {
          i += 2;
          continue;
        }
        if (ch === "\r" && i + 1 === chunk.length) {
          this.bareCrCarried = true;
        }
        i += 1;
        continue;
      }
      if (this.afterClosingQuote) {
        if (ch === '"') {
          // Escaped quote pair straddling the chunk boundary — the apparent
          // close actually reopened the quoted cell (`"a""b"`).
          this.inQuotes = true;
          this.insideOpeningQuote = false;
          this.atCellStart = false;
          this.afterClosingQuote = false;
          this.recordHasContent = true;
          i += 1;
          continue;
        }
        if (ch === ",") {
          this.atCellStart = true;
          this.afterClosingQuote = false;
          i += 1;
          continue;
        }
        if (ch === "\n" || ch === "\r") {
          this.afterClosingQuote = false;
          // fall through to the record-end handling below without consuming.
        } else {
          this.failure = "unexpected characters after a closing quote";
          return;
        }
      }
      if (this.atCellStart && ch === '"') {
        this.inQuotes = true;
        this.insideOpeningQuote = true;
        this.atCellStart = false;
        this.recordHasContent = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        this.atCellStart = true;
        i += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        this.logicalRecords += 1;
        this.recordHasContent = false;
        this.atCellStart = true;
        if (ch === "\r" && chunk[i + 1] === "\n") {
          i += 2;
        } else {
          if (ch === "\r" && i + 1 === chunk.length) {
            this.bareCrCarried = true;
          }
          i += 1;
        }
        continue;
      }
      if (this.atCellStart && CSV_RISKY_LEADING_CHARS.has(ch)) {
        this.failure =
          "spreadsheet-formula-like cell (must be neutralized by the plugin)";
        return;
      }
      this.atCellStart = false;
      this.recordHasContent = true;
      i += 1;
    }
  }

  public finish(): { ok: true; dataRecords: number } | { ok: false; error: string } {
    if (this.failure !== null) return { ok: false, error: this.failure };
    if (this.inQuotes) {
      return { ok: false, error: "unterminated quoted field in CSV" };
    }
    let logicalFinal = this.logicalRecords;
    if (this.recordHasContent) logicalFinal += 1;
    if (logicalFinal === 0) return { ok: true, dataRecords: 0 };
    // Record 1 is always the fixed header row.
    return { ok: true, dataRecords: Math.max(0, logicalFinal - 1) };
  }
}

/**
 * G03 streaming UTF-8 chunk decoder: carries an unterminated multi-byte
 * sequence into the next chunk so chunk boundaries never corrupt characters
 * (the scanners above walk plain JS strings).
 */
export class Utf8ChunkDecoder {
  private pending: Buffer = Buffer.alloc(0);

  public decode(chunk: Buffer): string {
    const buf =
      this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    if (buf.length === 0) return "";
    const cut = utf8SplitPoint(buf);
    this.pending = cut < buf.length ? buf.subarray(cut) : Buffer.alloc(0);
    return buf.subarray(0, cut).toString("utf8");
  }
}

function utf8SplitPoint(buf: Buffer): number {
  const n = buf.length;
  for (let i = n - 1; i >= Math.max(0, n - 3); i -= 1) {
    const b = buf[i] as number;
    if ((b & 0x80) === 0) return n; // ASCII — everything decodable
    if ((b & 0xc0) === 0xc0) {
      // lead byte: hold it (and its continuation) for the next chunk unless
      // the full sequence already fits.
      const expected =
        (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : (b & 0xf8) === 0xf0 ? 4 : 1;
      return i + expected <= n ? n : i;
    }
  }
  return n; // drift/malformed — decode as replacement chars
}

/**
 * Validate a v1 JSON artifact document (design §13.3): an object with
 * schemaVersion 1, a REQUIRED `records` array, and object records. A missing
 * records array must never masquerade as an empty dataset (B10).
 */
export function validatePluginArtifactJsonDoc(
  text: string
): { ok: true; recordCount: number } | { ok: false; error: string } {
  const state = new JsonArtifactValidationState();
  state.consume(text);
  return state.finish();
}

/**
 * G03 streaming JSON artifact validator — an explicit, iterative, chunk-fed
 * scanner for the FIXED v1 structure `{"schemaVersion":1,"records":[{...}]}`:
 *
 *  - the root must be an OBJECT (same error as the legacy whole-parse path),
 *  - `records` must be an array whose items are objects, counted while fed,
 *  - `schemaVersion` must be the number 1,
 *  - unknown keys/other errors follow the exactly the legacy messages and
 *    precedence, and
 *  - everything is processed in bounded chunks — a 100 MiB file is parsed
 *    through ≤1 MiB string slices, never held in one Buffer + one string.
 *
 * Consumes strictly-valid JSON (identical verdicts to JSON.parse for
 * malformed input, trailing commas, control characters, bad numbers, etc.).
 */
export class JsonArtifactValidationState {
  /** Structural failure, once set — every error message matches the legacy
   * whole-parse verdicts (validatePluginArtifactJsonDoc). */
  private failure: string | null = null;
  private rootNotObject = false;
  private recordsNotArray = false;
  private recordsMissing = true;
  private schemaBad = false;
  private itemsBad = false;
  private recordCount = 0;
  /** True once the first non-whitespace char was seen. */
  private rootStarted = false;
  /** True once the root value CLOSED (trailing garbage check). */
  private rootClosed = false;

  private frames: Array<
    | {
        kind: "object";
        hostRole: "root" | "item" | "skipped";
        mode: "expectKey" | "expectKeyAfterComma" | "expectColon" | "expectValue" | "expectCommaOrClose";
      }
    | {
        kind: "array";
        hostRole: "records" | "skipped";
        mode: "firstItem" | "expectItemAfterComma" | "expectCommaOrClose";
      }
  > = [];
  /** What the NEXT value applies to (from the owning object's last key). */
  private pendingKeyRole: "none" | "records" | "schemaVersion" = "none";
  /** In-progress string reader ("key" vs "value"; key role decided on close). */
  private stringReading: "none" | "key" | "value" = "none";
  private stringEscaped = false;
  private stringCodeUnits = 0;
  private stringBuf = "";
  /** In-progress JSON number. */
  private numberBuf = "";
  private numberReading = false;
  /** In-progress literal (true/false/null). */
  private literalExpected: "true" | "false" | "null" | null = null;
  private literalPos = 0;

  /** True when structural validation failed (stop-consuming hint for scans). */
  public failed(): boolean {
    return this.failure !== null;
  }

  public consume(text: string): void {
    if (this.failure !== null) return;
    for (const ch of text) {
      this.consumeChar(ch);
      if (this.failure !== null) return;
    }
  }

  private fail(error: string): void {
    this.failure = error;
  }

  private consumeChar(ch: string): void {
    if (this.stringReading !== "none") {
      // Whitespace inside a string is a control char, not a token boundary.
      this.consumeStringChar(ch);
      return;
    }
    if (this.numberReading) {
      // Whitespace terminates the number (the re-dispatch below skips it).
      this.consumeNumberChar(ch);
      return;
    }
    if (this.literalExpected !== null) {
      // Whitespace inside a literal is a mismatch, not a boundary.
      this.consumeLiteralChar(ch);
      return;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return;

    if (this.frames.length === 0) {
      if (this.rootClosed) {
        this.fail("not valid JSON"); // trailing non-whitespace
        return;
      }
      this.rootStarted = true;
      if (ch === "{") {
        this.frames.push({ kind: "object", hostRole: "root", mode: "expectKey" });
        return;
      }
      if (ch === "[") {
        this.rootNotObject = true;
        this.frames.push({ kind: "array", hostRole: "skipped", mode: "firstItem" });
        return;
      }
      this.rootNotObject = true; // scalar root
      if (ch === '"') this.startString("value");
      else this.startScalarOrLiteral(ch);
      return;
    }

    const top = this.frames[this.frames.length - 1] as
      | (typeof this.frames)[number]
      | undefined;
    if (!top) return;
    if (top.kind === "object") this.consumeObjectChar(top, ch);
    else this.consumeArrayChar(top, ch);
  }

  private consumeObjectChar(
    top: { kind: "object"; hostRole: "root" | "item" | "skipped"; mode: "expectKey" | "expectKeyAfterComma" | "expectColon" | "expectValue" | "expectCommaOrClose" },
    ch: string
  ): void {
    switch (top.mode) {
      case "expectKey":
        if (ch === "}") {
          // `{}` — an empty (item/root) object is legal JSON.
          this.frames.pop();
          this.settleContainerClose(top.hostRole === "item" ? "item" : undefined);
          return;
        }
        if (ch === '"') {
          this.startString("key");
          top.mode = "expectColon";
          return;
        }
        this.fail("not valid JSON");
        return;
      case "expectKeyAfterComma":
        if (ch === "}") {
          this.fail("not valid JSON"); // trailing comma
          return;
        }
        if (ch !== '"') {
          this.fail("not valid JSON");
          return;
        }
        this.startString("key");
        top.mode = "expectColon";
        return;
      case "expectColon":
        if (ch !== ":") {
          this.fail("not valid JSON");
          return;
        }
        top.mode = "expectValue";
        return;
      case "expectValue":
        this.startValue(ch, top);
        return;
      case "expectCommaOrClose":
        this.closeObject(top, ch);
        return;
    }
  }

  private closeObject(
    top: { kind: "object"; hostRole: "root" | "item" | "skipped"; mode: "expectKey" | "expectKeyAfterComma" | "expectColon" | "expectValue" | "expectCommaOrClose" },
    ch: string
  ): void {
    if (ch === "}") {
      if (top.mode === "expectValue") {
        this.fail("not valid JSON"); // `{ "a": }`
        return;
      }
      this.frames.pop();
      this.settleContainerClose(top.hostRole === "item" ? "item" : undefined);
      return;
    }
    if (ch === ",") {
      if (top.mode === "expectValue") {
        this.fail("not valid JSON"); // `{ "a": ,`
        return;
      }
      top.mode = "expectKeyAfterComma";
      return;
    }
    this.fail("not valid JSON");
  }

  private consumeArrayChar(
    top: { kind: "array"; hostRole: "records" | "skipped"; mode: "firstItem" | "expectItemAfterComma" | "expectCommaOrClose" },
    ch: string
  ): void {
    if (ch === "]") {
      if (top.mode === "expectItemAfterComma") {
        this.fail("not valid JSON"); // trailing comma
        return;
      }
      if (top.mode === "firstItem" && top.hostRole === "records") {
        // Empty records array is legal (0 records).
        this.recordsMissing = false;
      }
      this.frames.pop();
      this.settleContainerClose();
      return;
    }
    if (ch === ",") {
      if (top.mode === "expectCommaOrClose") {
        top.mode = "expectItemAfterComma";
        return;
      }
      this.fail("not valid JSON"); // leading/double comma
      return;
    }
    if (top.mode === "expectCommaOrClose") {
      this.fail("not valid JSON"); // missing comma between items
      return;
    }
    this.startValue(ch, top);
  }

  /** Begin a value: nested containers push frames; scalars start readers. */
  private startValue(
    ch: string,
    top:
      | { kind: "object" }
      | { kind: "array"; hostRole: "records" | "skipped" }
  ): void {
    if (ch === "{") {
      // `records` must bind to an ARRAY — any object there is not it.
      if (this.pendingKeyRole === "records") {
        this.recordsNotArray = true;
        this.recordsMissing = false;
        this.pendingKeyRole = "none";
        this.frames.push({ kind: "object", hostRole: "skipped", mode: "expectKey" });
        return;
      }
      this.frames.push({
        kind: "object",
        hostRole:
          top.kind === "array" && top.hostRole === "records" ? "item" : "skipped",
        mode: "expectKey",
      });
      return;
    }
    if (ch === "[") {
      if (this.pendingKeyRole === "records") {
        this.recordsMissing = false;
        this.pendingKeyRole = "none";
        this.frames.push({ kind: "array", hostRole: "records", mode: "firstItem" });
        return;
      }
      if (top.kind === "array" && top.hostRole === "records") {
        this.itemsBad = true; // nested-array record
      }
      this.frames.push({ kind: "array", hostRole: "skipped", mode: "firstItem" });
      return;
    }
    if (ch === '"') {
      // String items directly in `records` are not objects.
      if (top.kind === "array" && top.hostRole === "records") this.itemsBad = true;
      this.startString("value");
      return;
    }
    this.startScalarOrLiteral(ch, top.kind === "array" && top.hostRole === "records");
  }

  private startScalarOrLiteral(ch: string, inRecordsArray = false): void {
    if (ch === "t") {
      // `true` items directly in `records` are not objects.
      if (inRecordsArray) this.itemsBad = true;
      this.beginLiteral("true");
    } else if (ch === "f") {
      if (inRecordsArray) this.itemsBad = true;
      this.beginLiteral("false");
    } else if (ch === "n") {
      if (inRecordsArray) this.itemsBad = true;
      this.beginLiteral("null");
    } else if (ch === "-" || /[0-9]/.test(ch)) {
      if (inRecordsArray) this.itemsBad = true;
      this.numberBuf = ch;
      this.numberReading = true;
      return;
    } else this.fail("not valid JSON");
  }

  private beginLiteral(expected: "true" | "false" | "null"): void {
    this.literalExpected = expected;
    this.literalPos = 1;
  }

  private consumeLiteralChar(ch: string): void {
    const expected = this.literalExpected as string;
    if (this.literalPos >= expected.length) {
      this.fail("not valid JSON"); // `truex`
      return;
    }
    if (ch !== expected[this.literalPos]) {
      this.fail("not valid JSON");
      return;
    }
    this.literalPos += 1;
    if (this.literalPos === expected.length) {
      // Literal complete.
      if (this.pendingKeyRole === "schemaVersion") this.schemaBad = true;
      else if (this.pendingKeyRole === "records") this.recordsNotArray = true;
      this.literalExpected = null;
      this.settleScalarValue();
    }
  }

  private consumeNumberChar(ch: string): void {
    if (/^[-+0-9eE.]$/.test(ch)) {
      this.numberBuf += ch;
      return;
    }
    // Delimiter reached — validate the collected number.
    const ok =
      /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(this.numberBuf);
    this.numberReading = false;
    if (!ok) {
      this.numberBuf = "";
      this.fail("not valid JSON");
      return;
    }
    if (this.pendingKeyRole === "schemaVersion") {
      this.schemaBad = Number(this.numberBuf) !== 1;
    } else if (this.pendingKeyRole === "records") {
      this.recordsNotArray = true;
    }
    this.numberBuf = "";
    this.settleScalarValue();
    // The delimiter that terminated the number was consumed here — re-run
    // it through the normal dispatch so the owning frame advances.
    this.consumeChar(ch);
  }

  /** A scalar value completed — advance/park the owning frame. */
  private settleScalarValue(): void {
    this.pendingKeyRole = "none";
    const top = this.frames[this.frames.length - 1];
    if (!top) {
      // Root scalar finished.
      this.rootClosed = true;
      return;
    }
    if (top.kind === "object") top.mode = "expectCommaOrClose";
    else top.mode = "expectCommaOrClose";
  }

  private startString(role: "key" | "value"): void {
    this.stringReading = role;
    this.stringBuf = "";
    this.stringEscaped = false;
    this.stringCodeUnits = 0;
  }

  private consumeStringChar(ch: string): void {
    if (this.stringEscaped) {
      this.stringEscaped = false;
      if (this.stringCodeUnits > 0) {
        if (/^[0-9a-fA-F]$/.test(ch)) {
          this.stringCodeUnits -= 1;
          return;
        }
        this.fail("not valid JSON");
        return;
      }
      if (ch === "u") {
        this.stringCodeUnits = 4;
        return;
      }
      if ("\"\\/bfnrt".includes(ch)) {
        return;
      }
      this.fail("not valid JSON");
      return;
    }
    if (ch === "\\") {
      this.stringEscaped = true;
      return;
    }
    if (ch === '"') {
      this.finishString();
      return;
    }
    if (ch.charCodeAt(0) < 0x20) {
      this.fail("not valid JSON");
      return;
    }
    if (this.stringBuf.length < 4096) this.stringBuf += ch;
  }

  private finishString(): void {
    const role = this.stringReading;
    this.stringReading = "none";
    const top = this.frames[this.frames.length - 1];
    if (role === "key") {
      if (top && top.kind === "object" && top.hostRole === "root") {
        this.pendingKeyRole =
          this.stringBuf === "records"
            ? "records"
            : this.stringBuf === "schemaVersion"
              ? "schemaVersion"
              : "none";
      } else {
        this.pendingKeyRole = "none";
      }
      if (top && top.kind === "object" && top.mode === "expectColon") {
        // mode already expectColon (set at startString) — nothing to do.
      }
      this.stringBuf = "";
      return;
    }
    // value string
    if (this.pendingKeyRole === "records") {
      this.recordsNotArray = true;
      this.pendingKeyRole = "none";
    } else if (this.pendingKeyRole === "schemaVersion") {
      this.schemaBad = true;
      this.pendingKeyRole = "none";
    }
    this.settleScalarValue();
  }

  /** A container frame closed — settle the owner and count records. */
  private settleContainerClose(recordCountedFrame?: "item"): void {
    if (recordCountedFrame === "item") this.recordCount += 1;
    const owner = this.frames[this.frames.length - 1];
    if (!owner) {
      this.rootClosed = true;
      return;
    }
    if (owner.kind === "object") owner.mode = "expectCommaOrClose";
    else owner.mode = "expectCommaOrClose";
  }

  public finish(): { ok: true; recordCount: number } | { ok: false; error: string } {
    if (this.failure !== null) return { ok: false, error: this.failure };
    if (
      !this.rootStarted ||
      this.rootClosed === false ||
      this.frames.length > 0 ||
      this.numberReading ||
      this.literalExpected !== null ||
      this.stringReading !== "none"
    ) {
      return { ok: false, error: "not valid JSON" };
    }
    if (this.rootNotObject) {
      return { ok: false, error: "JSON artifact must be an object with a records array" };
    }
    if (this.recordsMissing || this.recordsNotArray) {
      return { ok: false, error: "JSON artifact is missing the records array" };
    }
    if (this.schemaBad) {
      return { ok: false, error: "unsupported JSON artifact schemaVersion" };
    }
    if (this.itemsBad) {
      return { ok: false, error: "JSON artifact records must be objects" };
    }
    return { ok: true, recordCount: this.recordCount };
  }
}

/**
 * Bounded RFC-4180 record extraction for previews (B01): quoted commas and
 * quoted newlines are NOT record boundaries, \r\n / \r / \n each terminate a
 * record, and a final unterminated record with content is included. Only
 * `maxRecords` records are returned even if the text holds more.
 */
export function extractCsvPreviewRecords(
  text: string,
  maxRecords: number
): {
  records: string[];
  /** True when records exist beyond `maxRecords` (or text was cut). */
  hasMore: boolean;
  /** True when the text ends inside an open quoted field. */
  cutInsideQuotes: boolean;
} {
  const records: string[] = [];
  let recordStart = 0;
  let i = 0;
  let inQuotes = false;
  while (i < text.length && records.length < maxRecords) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          i += 2;
          continue;
        }
        inQuotes = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    let terminatorLength = 0;
    if (ch === "\r") terminatorLength = text[i + 1] === "\n" ? 2 : 1;
    else if (ch === "\n") terminatorLength = 1;
    if (terminatorLength > 0) {
      records.push(text.slice(recordStart, i));
      i += terminatorLength;
      recordStart = i;
      continue;
    }
    i += 1;
  }
  if (records.length < maxRecords && recordStart < text.length) {
    records.push(text.slice(recordStart));
  }
  const exhausted = records.length < maxRecords;
  const hasMore =
    !exhausted && (i < text.length || recordStart < text.length);
  return { records, hasMore, cutInsideQuotes: inQuotes };
}

/** Per-field cap for a JSON preview record (B01, "individual fields"). */
const PREVIEW_FIELD_CHARS = 512;

/** Maximum nested keys/values retained from one record's sub-structures. */
const PREVIEW_MAX_ENTRIES = 32;

function boundPreviewValue(value: unknown, maxFieldChars: number): unknown {
  if (typeof value === "string") {
    return value.length > maxFieldChars
      ? `${value.slice(0, maxFieldChars)}…`
      : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, PREVIEW_MAX_ENTRIES)
      .map((v) => boundPreviewValue(v, maxFieldChars));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (kept >= PREVIEW_MAX_ENTRIES) break;
      out[key] = boundPreviewValue(entry, maxFieldChars);
      kept += 1;
    }
    return out;
  }
  return value;
}

/**
 * Bound+cap a list of JSON record items into the allowlisted preview
 * envelope (B01): per-field caps, per-record keep loop, hard envelope byte
 * cap, and a `truncated` flag whenever anything was dropped or cut.
 */
function buildJsonPreviewEnvelope(
  schemaVersion: number | undefined,
  items: unknown[],
  moreAvailable: boolean,
  maxRecords: number,
  maxEnvelopeBytes: number,
  inputWasCut: boolean
): { envelope: PluginArtifactJsonPreview; truncated: boolean } {
  const kept: unknown[] = [];
  let truncated = inputWasCut || moreAvailable || items.length > maxRecords;
  let bytes = 0;
  for (const item of items) {
    if (kept.length >= maxRecords) {
      truncated = true;
      break;
    }
    const rendered = boundPreviewValue(item, PREVIEW_FIELD_CHARS);
    const encoded = JSON.stringify(rendered);
    // Per-field/per-entry clipping shrank the record (B01 reports it).
    if (
      Buffer.byteLength(JSON.stringify(item), "utf8") >
      Buffer.byteLength(encoded, "utf8")
    ) {
      truncated = true;
    }
    const nextBytes =
      bytes + (bytes > 0 ? 1 : 0) + Buffer.byteLength(encoded, "utf8");
    if (nextBytes > maxEnvelopeBytes && kept.length > 0) {
      truncated = true;
      break;
    }
    kept.push(rendered);
    bytes = nextBytes;
  }
  return {
    envelope: { schemaVersion, records: kept, truncated },
    truncated,
  };
}

/** Allowlisted JSON preview envelope (B01): no arbitrary top-level fields. */
export interface PluginArtifactJsonPreview {
  schemaVersion?: number;
  records: unknown[];
  truncated: boolean;
}

/**
 * Extract a bounded JSON preview envelope from a (possibly input-cut) text
 * slice (B01). Full parse first; when the slice ends mid-document, complete
 * top-level `records` items are extracted scanner-style and re-parsed.
 */
export function extractJsonPreviewRecords(
  text: string,
  inputWasCut: boolean,
  maxRecords: number,
  maxEnvelopeBytes: number
): { envelope: PluginArtifactJsonPreview; truncated: boolean } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const doc = parsed as Record<string, unknown>;
    if (Array.isArray(doc.records)) {
      const items = doc.records as unknown[];
      const schemaVersion =
        typeof doc.schemaVersion === "number" ? doc.schemaVersion : undefined;
      return buildJsonPreviewEnvelope(
        schemaVersion,
        items,
        false,
        maxRecords,
        maxEnvelopeBytes,
        inputWasCut
      );
    }
  }

  // Input-cut recovery: locate the records array and pull complete items.
  const keyIndex = text.indexOf('"records"');
  if (keyIndex < 0) return null;
  const colonIndex = text.indexOf(":", keyIndex);
  const scanFrom = text.indexOf("[", colonIndex);
  if (colonIndex < 0 || scanFrom < 0) return null;
  let scan = scanFrom + 1;
  const itemsText: string[] = [];
  let itemStart = scan;
  let depth = 0;
  let inString = false;
  let escaped = false;
  while (scan < text.length) {
    const ch = text[scan];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      scan += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      scan += 1;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      if (depth === 0) {
        if (itemStart < scan) itemsText.push(text.slice(itemStart, scan));
        return finalizeExtractedItems(itemsText, false, maxRecords, maxEnvelopeBytes, inputWasCut);
      }
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      if (itemStart < scan) itemsText.push(text.slice(itemStart, scan));
      itemStart = scan + 1;
      if (itemsText.length >= maxRecords + 1) {
        return finalizeExtractedItems(itemsText, true, maxRecords, maxEnvelopeBytes, inputWasCut);
      }
    }
    scan += 1;
  }
  // Slice ended before the array closed: salvage complete items only.
  if (itemStart < scan && depth === 0 && !inString) {
    itemsText.push(text.slice(itemStart, scan));
  }
  return finalizeExtractedItems(itemsText, true, maxRecords, maxEnvelopeBytes, inputWasCut);
}

function finalizeExtractedItems(
  itemsText: string[],
  moreAvailable: boolean,
  maxRecords: number,
  maxEnvelopeBytes: number,
  inputWasCut: boolean
): { envelope: PluginArtifactJsonPreview; truncated: boolean } | null {
  if (itemsText.length === 0) return null;
  let items: unknown[];
  try {
    items = JSON.parse(`[${itemsText.join(",")}]`) as unknown[];
  } catch {
    return null;
  }
  if (items.length === 0) return null;
  return buildJsonPreviewEnvelope(
    undefined,
    items,
    moreAvailable,
    maxRecords,
    maxEnvelopeBytes,
    inputWasCut
  );
}

export class PluginFileArtifactService {
  private readonly root: string;
  private readonly fs: ArtifactFs;
  private readonly now: () => number;
  /** Scope identity used for metadata normalization (G03). */
  private readonly scopeId: string;
  /** Effective limits (defaults merged with injectable overrides — G03 seams). */
  private readonly limits: typeof PLUGIN_ARTIFACT_LIMITS;

  constructor(
    options?: {
      root?: string;
      scopeId?: string;
      fs?: ArtifactFs;
      limits?: PluginArtifactLimitsOverrides;
    },
    now?: () => number
  ) {
    this.root =
      options?.root ??
      path.join(
        getElectronUserDataPath(),
        "plugin-artifacts",
        options?.scopeId ?? "default"
      );
    this.scopeId = options?.scopeId ?? "default";
    this.fs = options?.fs ?? defaultFs();
    this.now = now ?? ((): number => Date.now());
    this.limits = { ...PLUGIN_ARTIFACT_LIMITS, ...(options?.limits ?? {}) };
  }

  // ------------------------------------------------------------------ staging

  /** Provision (idempotently) the per-execution staging directory. */
  public provisionStaging(executionId: string): string {
    const dir = this.stagingDir(executionId);
    this.fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // --------------------------------------------------------------------- G03 quotas

  /**
   * Total bytes of READABLE promoted artifacts in this scope's store
   * (authoritative metadata sizeBytes; unreadable/legacy entries count the
   * content file when stat succeeds, else 0 — never claimed).
   */
  public storeUsageBytes(): number {
    const artifactsRoot = path.join(this.root, "artifacts");
    if (!this.fs.existsSync(artifactsRoot)) return 0;
    let total = 0;
    let ids: string[] = [];
    try {
      ids = this.fs.readdirSync(artifactsRoot);
    } catch {
      return 0;
    }
    for (const id of ids) {
      try {
        const artifact = this.readArtifact(path.join(artifactsRoot, id));
        if (artifact) {
          total += artifact.sizeBytes;
          continue;
        }
        // Corrupt/legacy metadata: fall back to a content-file stat.
        for (const name of ["content.json", "content.csv"]) {
          const p = path.join(artifactsRoot, id, name);
          if (this.fs.existsSync(p)) total += this.fs.statSync(p).size;
        }
      } catch {
        continue;
      }
    }
    return total;
  }

  /** Store bytes attributable to ONE plugin (per-plugin quota, G03). */
  public pluginUsageBytes(pluginName: string): number {
    const artifactsRoot = path.join(this.root, "artifacts");
    if (!this.fs.existsSync(artifactsRoot)) return 0;
    let total = 0;
    let ids: string[] = [];
    try {
      ids = this.fs.readdirSync(artifactsRoot);
    } catch {
      return 0;
    }
    for (const id of ids) {
      try {
        const artifact = this.readArtifact(path.join(artifactsRoot, id));
        if (artifact && artifact.pluginName === pluginName) {
          total += artifact.sizeBytes;
        }
      } catch {
        continue;
      }
    }
    return total;
  }

  /**
   * G03 quota preflight: verifies BEFORE admission/spawn (and separately per
   * candidate at promotion) that admitting `incomingBytes` more artifact
   * bytes stays within the store and per-plugin quotas AND keeps the required
   * free-disk cushion. Platforms without statfs (and every test without the
   * seam) skip only the disk check.
   */
  public preflightArtifactQuota(
    pluginName: string,
    incomingBytes = 0
  ): PluginArtifactQuotaCheck {
    let storeUsage = 0;
    let pluginUsage = 0;
    let freeDiskBytes: number | null = null;
    try {
      storeUsage = this.storeUsageBytes();
    } catch {
      storeUsage = 0;
    }
    try {
      pluginUsage = this.pluginUsageBytes(pluginName);
    } catch {
      pluginUsage = 0;
    }
    try {
      const statfs = this.fs.statfsSync?.(this.root);
      if (statfs) freeDiskBytes = statfs.bavail * statfs.bsize;
    } catch {
      freeDiskBytes = null; // unreadable volume → disk check skipped
    }
    if (storeUsage + incomingBytes > this.limits.maxStoreBytes) {
      return {
        ok: false,
        code: "STORE_QUOTA",
        error: `plugin artifact store quota exceeded (${storeUsage} bytes used, limit ${this.limits.maxStoreBytes})`,
      };
    }
    if (
      pluginUsage + incomingBytes >
      this.limits.maxPluginStoreBytes
    ) {
      return {
        ok: false,
        code: "PLUGIN_QUOTA",
        error: `per-plugin artifact quota exceeded for ${pluginName} (${pluginUsage} bytes used, limit ${this.limits.maxPluginStoreBytes})`,
      };
    }
    if (
      freeDiskBytes !== null &&
      freeDiskBytes - incomingBytes < this.limits.minFreeDiskBytes
    ) {
      return {
        ok: false,
        code: "DISK_SPACE",
        error: `insufficient free disk space for plugin artifacts (${freeDiskBytes} bytes free, ${this.limits.minFreeDiskBytes} required)`,
      };
    }
    return { ok: true, storeUsageBytes: storeUsage, pluginUsageBytes: pluginUsage, freeDiskBytes };
  }

  // ------------------------------------------------------------------ journals (G03)

  /**
   * Create a journal at spawn (status "running") so executions interrupted
   * by a crash/restart stay conversation-linkable. The atomic-rename writer
   * guarantees a journal is never readable half-written (G03).
   */
  public beginExecutionJournal(input: {
    readonly executionId: string;
    readonly conversationId: string;
    readonly pluginName: string;
  }): void {
    try {
      this.assertSafeComponent(input.executionId);
    } catch {
      return;
    }
    this.writeJournal(input.executionId, {
      status: "running",
      artifacts: [],
      errors: [],
      conversationId: input.conversationId,
      pluginName: input.pluginName,
    });
  }

  /** Atomic-read a journal entry (null when missing/unreadable). */
  public readJournalState(executionId: string): {
    status: string;
    at: string | null;
    conversationId: string | null;
    pluginName: string | null;
    registeredCount: number;
    message: string | null;
  } | null {
    try {
      this.assertSafeComponent(executionId);
      const parsed = this.readJournalFile(path.join(this.root, "journal", `${executionId}.json`));
      if (!parsed) return null;
      return {
        status: parsed.status,
        at: parsed.at,
        conversationId: parsed.conversationId,
        pluginName: parsed.pluginName,
        registeredCount: parsed.registeredCount,
        message: parsed.message,
      };
    } catch {
      return null;
    }
  }

  /**
   * Conversation-facing journal states (G03): executions linked to the
   * conversation, used instead of a journal file the UI never reads —
   * interrupted/failed executions are surfaced through the artifact card.
   */
  public listJournalStatesForConversation(
    conversationId: string
  ): PluginExecutionJournalState[] {
    const out: PluginExecutionJournalState[] = [];
    const journalDir = path.join(this.root, "journal");
    if (!this.fs.existsSync(journalDir) || conversationId.length === 0) {
      return out;
    }
    let names: string[] = [];
    try {
      names = this.fs.readdirSync(journalDir);
    } catch {
      return out;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = this.readJournalFile(path.join(journalDir, name));
        if (!parsed || parsed.conversationId !== conversationId) continue;
        out.push({
          executionId: name.replace(/\.json$/, ""),
          status: parsed.status,
          at: parsed.at,
          conversationId: parsed.conversationId,
          pluginName: parsed.pluginName,
          registeredCount: parsed.registeredCount,
          message: parsed.message,
        });
      } catch {
        continue;
      }
    }
    return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  }

  /**
   * G03 uninstall retention: a plugin's artifacts keep their data for a
   * SHORTER window after uninstall (user data, not plugin property — removal
   * stays at natural expiry; exported copies are outside the store by
   * definition and are never touched).
   */
  public applyPluginUninstallRetention(
    pluginName: string,
    retentionMs?: number
  ): number {
    const effectiveRetention =
      retentionMs ?? this.limits.pluginUninstallRetentionMs;
    let reconfirmed = 0;
    const artifactsRoot = path.join(this.root, "artifacts");
    if (!this.fs.existsSync(artifactsRoot)) return 0;
    let ids: string[] = [];
    try {
      ids = this.fs.readdirSync(artifactsRoot);
    } catch {
      return 0;
    }
    const expiresAt = new Date(
      this.now() + effectiveRetention
    ).toISOString();
    for (const id of ids) {
      try {
        const dir = path.join(artifactsRoot, id);
        const artifact = this.readArtifact(dir);
        if (!artifact || artifact.pluginName !== pluginName) continue;
        if (artifact.expiresAt <= expiresAt) continue; // already expiring sooner
        // Status is preserved: the artifacts are complete; only their
        // retention window shrinks (they are user data, not plugin data).
        const updated: RegisteredPluginArtifact = {
          ...artifact,
          expiresAt,
        };
        this.writeMetadataAtomic(dir, updated);
        reconfirmed += 1;
      } catch {
        continue;
      }
    }
    return reconfirmed;
  }

  /** Atomic metadata rewrite helper (tmp + rename). */
  private writeMetadataAtomic(
    dir: string,
    artifact: RegisteredPluginArtifact
  ): void {
    const metaTmp = path.join(dir, "metadata.json.tmp");
    this.fs.writeFileSync(metaTmp, JSON.stringify(artifact), { mode: 0o600 });
    this.fs.renameSync(metaTmp, path.join(dir, "metadata.json"));
  }

  /** Staging path for an execution (does not create it). */
  public stagingDir(executionId: string): string {
    this.assertSafeComponent(executionId);
    return path.join(this.root, "staging", executionId);
  }

  /** True when the staging directory exists (crash-safe execution reads). */
  public stagingExists(executionId: string): boolean {
    try {
      this.assertSafeComponent(executionId);
    } catch {
      return false;
    }
    return this.fs.existsSync(this.stagingDir(executionId));
  }

  /**
   * Crash-safe read of the plugin's candidate manifest (H2). Only candidates
   * with a shape the host recognizes AND that claim `complete` finalization
   * are returned — promotion therefore registers listed, finalized files
   * only, and never a half-written data file (design §13.2).
   */
  public readCandidates(executionId: string): PluginArtifactCandidate[] {
    try {
      this.assertSafeComponent(executionId);
    } catch {
      return [];
    }
    const manifest = path.join(
      this.stagingDir(executionId),
      "candidates.json"
    );
    if (!this.fs.existsSync(manifest)) return [];
    let parsed: unknown;
    // Plugin-controlled metadata: bound the read before parsing (B10) —
    // an oversized manifest is never fed to JSON.parse.
    try {
      const manifestStat = this.fs.lstatSync(manifest);
      if (
        manifestStat.isSymbolicLink() ||
        manifestStat.isFile() !== true ||
        this.fs.statSync(manifest).size >
          this.limits.maxCandidatesManifestBytes
      ) {
        log.warn(
          `[PluginFileArtifactService] candidates manifest rejected for ${executionId} (missing/oversized/not-a-regular-file)`
        );
        return [];
      }
    } catch {
      return [];
    }
    try {
      parsed = JSON.parse(this.fs.readBufferSync(manifest).toString("utf8"));
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== "object") return [];
    const list = (parsed as { candidates?: unknown }).candidates;
    if (!Array.isArray(list)) return [];
    const out: PluginArtifactCandidate[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      if (c.version !== 1) continue;
      const isJsonPath = c.relativePath === "records.json";
      const isCsvPath = c.relativePath === "records.csv";
      if (!isJsonPath && !isCsvPath) continue;
      if (c.format !== "json" && c.format !== "csv") continue;
      if (
        typeof c.recordCount !== "number" ||
        !Number.isInteger(c.recordCount) ||
        c.recordCount < 0
      ) {
        continue;
      }
      // Register only FINALIZED files; an in-flight candidate is a
      // half-written file the host must never expose (design §13.2).
      if (c.complete !== true) continue;
      out.push({
        version: 1,
        relativePath: isJsonPath ? "records.json" : "records.csv",
        format: c.format,
        recordCount: c.recordCount,
        complete: true,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- startup sweep

  /**
   * H6: startup sweep for executions interrupted by a host crash/restart.
   *
   * For every staging directory:
   *  - No journal OR a journal WITHOUT registered artifacts (never-promoted,
   *    interrupted, failed): the journal alone no longer counts as promotion
   *    (G03) — write an honest `interrupted` entry (preserving the owner
   *    identity when the previous journal had it), then move the orphan
   *    staging dir into `staging-quarantine`. Plugin-owned bytes are never
   *    deleted directly — a human may inspect them; the monitor sweeps
   *    quarantine by the same retention window.
   *  - Journal WITH registered artifacts (promotion finished, at least
   *    partially): retained staging ages out once the journal is older than
   *    the retention window (default 30 days).
   *
   * Runs BEFORE any plugin can start (background.ts whenReady), so races
   * with live executions are impossible.
   */
  public recoverStartupExecutions(
    retentionMs?: number
  ): { interrupted: string[]; agedPromotedStaging: string[] } {
    const effectiveRetention =
      retentionMs ?? this.limits.defaultRetentionMs;
    const out: { interrupted: string[]; agedPromotedStaging: string[] } = {
      interrupted: [],
      agedPromotedStaging: [],
    };
    const stagingRoot = path.join(this.root, "staging");
    const quarantineRoot = path.join(this.root, "staging-quarantine");
    const journalDir = path.join(this.root, "journal");
    if (!this.fs.existsSync(stagingRoot)) return out;
    let ids: string[];
    try {
      ids = this.fs.readdirSync(stagingRoot);
    } catch (e) {
      log.warn(
        `[PluginFileArtifactService] startup sweep could not read staging: ${String(e)}`
      );
      return out;
    }
    for (const id of ids) {
      let stagingPath: string;
      try {
        this.assertSafeComponent(id);
        stagingPath = path.join(stagingRoot, id);
        if (!this.fs.existsSync(stagingPath)) continue;
      } catch {
        continue; // unsafe component — hygiene sweep, not a job id
      }

      const journalPath = path.join(journalDir, `${id}.json`);
      const journal = this.readJournalFile(journalPath);
      // G03: promotion is only real when the journal holds registered
      // artifacts — mere journal existence (running/failed/empty) is an
      // interrupted-by-crash execution, never a promoted one.
      const promoted = journal !== null && journal.registeredCount > 0;
      if (!promoted) {
        try {
          this.writeJournal(id, {
            status: "interrupted",
            artifacts: [],
            errors: [
              `interrupted: host restart before promotion (startup sweep at ${new Date(
                this.now()
              ).toISOString()})`,
            ],
            conversationId: journal?.conversationId ?? null,
            pluginName: journal?.pluginName ?? null,
          });
          this.fs.mkdirSync(quarantineRoot, { recursive: true });
          try {
            this.fs.renameSync(stagingPath, path.join(quarantineRoot, id));
          } catch {
            // Quarantine target already exists (previous sweep) — drop.
            this.fs.rmSync(stagingPath, { recursive: true, force: true });
          }
          out.interrupted.push(id);
        } catch (e) {
          log.warn(
            `[PluginFileArtifactService] startup sweep failed for ${id}: ${String(e)}`
          );
        }
        continue;
      }

      // Promoted earlier: stale retained staging older than the journal's
      // published timestamp ages out with the same retention window.
      try {
        const parsed = this.readJournalFile(journalPath);
        const at =
          parsed?.at !== null && parsed?.at !== undefined
            ? Date.parse(parsed.at)
            : NaN;
        if (
          Number.isFinite(at) &&
          this.now() - at > effectiveRetention &&
          this.fs.existsSync(stagingPath)
        ) {
          this.fs.rmSync(stagingPath, { recursive: true, force: true });
          out.agedPromotedStaging.push(id);
        }
      } catch {
        // Unreadable journal: keep the dir for a later sweep.
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- promotion

  /**
   * Validate candidate files finalized by the plugin and promote them into
   * the immutable host-owned artifact store. Registration is idempotent per
   * (executionId, candidate path): a repeated promotion returns the existing
   * artifact instead of duplicating.
   */
  public promoteCandidates(input: {
    readonly executionId: string;
    readonly conversationId: string;
    readonly pluginName: string;
    readonly candidates: readonly PluginArtifactCandidate[];
    /** G03 identity: plugin manifest version/generation at promotion. */
    readonly pluginVersion?: string;
    readonly pluginGeneration?: string;
    /** G03 completion state of the producing tool call. */
    readonly resultStatus?: PluginArtifactStatus;
  }): { artifacts: RegisteredPluginArtifact[]; errors: string[] } {
    const errors: string[] = [];
    const artifacts: RegisteredPluginArtifact[] = [];
    const staging = this.stagingDir(input.executionId);

    if (!this.fs.existsSync(staging)) {
      return { artifacts, errors: ["staging directory does not exist"] };
    }
    // Staging/root ownership: resolve every symlink first; the staging root
    // must still live inside the host store (a swapped/staged symlinked
    // staging root would defeat containment — B10).
    let realRoot: string;
    let realStaging: string;
    try {
      realRoot = this.fs.realpathSync(this.root);
      realStaging = this.fs.realpathSync(staging);
    } catch (e) {
      return {
        artifacts,
        errors: [`staging path could not be resolved: ${String(e)}`],
      };
    }
    const stagingRootPrefix = path.join(realRoot, "staging");
    if (
      realStaging !== stagingRootPrefix &&
      !realStaging.startsWith(`${stagingRootPrefix}${path.sep}`)
    ) {
      return {
        artifacts,
        errors: ["staging directory is not owned by the artifact store"],
      };
    }
    if (
      input.candidates.length > this.limits.maxArtifactsPerExecution
    ) {
      // The promote loop below slices to the cap; a candidate beyond it is
      // only reported as dropped (the previous dead `slice(...)` call was
      // discarded by callers AND by the loop).
      errors.push(
        `too many candidates; only the first ${this.limits.maxArtifactsPerExecution} are considered`
      );
    }

    for (const candidate of input.candidates.slice(
      0,
      this.limits.maxArtifactsPerExecution
    )) {
      const validated = this.validateCandidate(staging, candidate, realStaging);
      if ("error" in validated) {
        errors.push(validated.error);
        continue;
      }
      // G03: per-candidate quota check right before the copy — disk-full,
      // store-plugin quota exceeded and similar conditions produce a
      // TRUTHFUL per-candidate error instead of a crash mid-copy.
      try {
        const size = this.fs.statSync(validated.file).size;
        const quota = this.preflightArtifactQuota(input.pluginName, size);
        if (!quota.ok) {
          errors.push(
            `artifact quota exceeded for ${candidate.relativePath}: ${quota.error}`
          );
          continue;
        }
      } catch (e) {
        errors.push(
          `promotion failed for ${candidate.relativePath}: ${String(e)}`
        );
        continue;
      }
      const artifactId = this.deriveArtifactId(input.executionId, candidate);
      const destDir = path.join(this.root, "artifacts", artifactId);
      const contentName =
        candidate.format === "json" ? "content.json" : "content.csv";

      // Idempotent registration (crash recovery cannot duplicate artifacts).
      if (this.fs.existsSync(path.join(destDir, "metadata.json"))) {
        const existing = this.readArtifact(destDir);
        if (existing) {
          artifacts.push(existing);
          continue;
        }
      }

      try {
        this.fs.mkdirSync(destDir, { recursive: true });
        // Copy into a NEW host-owned file (never accept a mutable link).
        this.fs.copyFileSync(validated.file, path.join(destDir, contentName));
        const contentPath = path.join(destDir, contentName);
        const stat = this.fs.statSync(contentPath);
        const registered: RegisteredPluginArtifact = {
          id: artifactId,
          format: candidate.format,
          recordCount: validated.recordCount,
          sizeBytes: stat.size,
          createdAt: new Date(this.now()).toISOString(),
          expiresAt: new Date(
            this.now() + this.limits.defaultRetentionMs
          ).toISOString(),
          conversationId: input.conversationId,
          pluginName: input.pluginName,
          digest: validated.digest,
          // G03 identity + state:
          schemaVersion: 1,
          executionId: input.executionId,
          mimeType: candidate.format === "json" ? "application/json" : "text/csv",
          userScopeId: this.scopeId,
          status: input.resultStatus ?? "complete",
          ...(input.pluginVersion !== undefined
            ? { pluginVersion: input.pluginVersion }
            : {}),
          ...(input.pluginGeneration !== undefined
            ? { pluginGeneration: input.pluginGeneration }
            : {}),
        };
        // Atomic metadata write: metadata is authoritative only after the
        // content copy completed.
        this.writeMetadataAtomic(destDir, registered);
        artifacts.push(registered);
      } catch (e) {
        errors.push(`promotion failed for ${candidate.relativePath}: ${String(e)}`);
      }
    }

    this.writeJournal(input.executionId, {
      status:
        artifacts.length === 0
          ? "failed"
          : input.resultStatus === "degraded" || errors.length > 0
            ? "degraded"
            : "complete",
      artifacts,
      errors,
      conversationId: input.conversationId,
      pluginName: input.pluginName,
    });
    // B12: staging is transient — once promotion is fully confirmed (no
    // errors, journal written), release it so normal outputs are not kept
    // duplicated in staging until a restart sweep. On partial errors the
    // staging dir is retained for idempotent re-promotion and the later
    // aging sweep.
    if (errors.length === 0) {
      this.releaseStaging(input.executionId);
    }
    return { artifacts, errors };
  }

  // ------------------------------------------------------------- consumption

  /** List artifacts for a conversation (ownership-scoped). */
  public listForConversation(
    conversationId: string
  ): RegisteredPluginArtifact[] {
    const out: RegisteredPluginArtifact[] = [];
    const nowIso = new Date(this.now()).toISOString();
    const artifactsRoot = path.join(this.root, "artifacts");
    if (!this.fs.existsSync(artifactsRoot)) return out;
    for (const id of this.fs.readdirSync(artifactsRoot)) {
      const artifact = this.readArtifact(path.join(artifactsRoot, id));
      if (!artifact || artifact.conversationId !== conversationId) continue;
      // B12: expired artifacts stay server-side garbage until the sweep;
      // listings never surface them.
      if (artifact.expiresAt <= nowIso) continue;
      out.push(artifact);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Bounded preview (B01): a positional byte slice of the artifact — never
   * the whole file — feeds RFC-4180-aware CSV record extraction or a
   * validated JSON envelope built from the allowlisted keys
   * (schemaVersion/records/truncated) with per-field byte caps. Rows AND
   * bytes are capped; `truncated` reports anything dropped or cut.
   */
  public preview(
    conversationId: string,
    artifactId: string,
    maxRows = 5
  ): {
    ok: true;
    format: PluginArtifactFormat;
    rows: string;
    truncated: boolean;
  } | { ok: false; error: string } {
    const artifact = this.requireOwned(artifactId, conversationId);
    if (!artifact) return { ok: false, error: "artifact not found" };
    const contentPath = path.join(
      this.root,
      "artifacts",
      artifactId,
      artifact.format === "json" ? "content.json" : "content.csv"
    );
    if (!this.fs.existsSync(contentPath)) {
      return { ok: false, error: "artifact content missing" };
    }
    const readBytes = this.limits.maxPreviewReadBytes;
    const slice = this.fs.readBufferSliceSync(contentPath, readBytes);
    const size = this.fs.statSync(contentPath).size;
    const inputWasCut = slice.length < size;
    const text = slice.toString("utf8");
    const maxEnvelopeBytes = this.limits.maxPreviewBytes;

    if (artifact.format === "csv") {
      // header row + maxRows data records
      const extraction = extractCsvPreviewRecords(text, maxRows + 1);
      let truncated =
        inputWasCut || extraction.hasMore || extraction.cutInsideQuotes;
      let joined = "";
      for (const record of extraction.records) {
        const candidate = joined.length === 0 ? record : `${joined}\n${record}`;
        if (Buffer.byteLength(candidate, "utf8") > maxEnvelopeBytes) {
          truncated = true;
          break;
        }
        joined = candidate;
      }
      return { ok: true, format: "csv", rows: joined, truncated };
    }

    const json = extractJsonPreviewRecords(
      text,
      inputWasCut,
      maxRows,
      maxEnvelopeBytes
    );
    if (json) {
      return {
        ok: true,
        format: "json",
        rows: JSON.stringify(json.envelope),
        truncated: json.truncated,
      };
    }
    // Legacy/unparseable content: bounded text fallback, still byte-capped.
    const fallbackRows = text.slice(0, maxEnvelopeBytes);
    return {
      ok: true,
      format: "json",
      rows: fallbackRows,
      truncated: inputWasCut || text.length > fallbackRows.length,
    };
  }

  /** Copy validated artifact bytes to a user-chosen destination (export). */
  public exportToPath(
    conversationId: string,
    artifactId: string,
    destination: string
  ): { ok: true; sizeBytes: number } | { ok: false; error: string } {
    const artifact = this.requireOwned(artifactId, conversationId);
    if (!artifact) return { ok: false, error: "artifact not found" };
    const contentPath = path.join(
      this.root,
      "artifacts",
      artifactId,
      artifact.format === "json" ? "content.json" : "content.csv"
    );
    if (!this.fs.existsSync(contentPath)) {
      return { ok: false, error: "artifact content missing" };
    }
    try {
      this.fs.copyFileSync(contentPath, destination);
      return { ok: true, sizeBytes: this.fs.statSync(destination).size };
    } catch (e) {
      return { ok: false, error: `export failed: ${String(e)}` };
    }
  }

  /** Delete an owned artifact (user action). */
  public delete(
    conversationId: string,
    artifactId: string
  ): { ok: boolean; error?: string } {
    const artifact = this.requireOwned(artifactId, conversationId);
    if (!artifact) return { ok: false, error: "artifact not found" };
    try {
      this.fs.rmSync(path.join(this.root, "artifacts", artifactId), {
        recursive: true,
        force: true,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ----------------------------------------------------------------- cleanup

  /** Remove an execution's staging directory (after terminal promotion). */
  public releaseStaging(executionId: string): void {
    try {
      this.fs.rmSync(this.stagingDir(executionId), {
        recursive: true,
        force: true,
      });
    } catch {
      /* best-effort */
    }
  }

  /**
   * Expire artifacts past their retention (startup / periodic sweep).
   * B12: also ages OUT quarantine entries and orphaned journals with the
   * same retention window so interrupted executions do not accumulate
   * forever. Staging dirs with no journal are untouched here — they are
   * reported + quarantined by the startup `recoverStartupExecutions` sweep.
   */
  public sweepExpired(
    retentionMs?: number
  ): number {
    const effectiveRetention =
      retentionMs ?? this.limits.defaultRetentionMs;
    let removed = 0;
    const nowIso = new Date(this.now()).toISOString();

    // 1. Promoted artifacts past their retention.
    const artifactsRoot = path.join(this.root, "artifacts");
    if (this.fs.existsSync(artifactsRoot)) {
      for (const id of this.fs.readdirSync(artifactsRoot)) {
        const artifact = this.readArtifact(path.join(artifactsRoot, id));
        if (artifact && artifact.expiresAt <= nowIso) {
          this.fs.rmSync(path.join(artifactsRoot, id), {
            recursive: true,
            force: true,
          });
          removed += 1;
        }
      }
    }

    // 2. Quarantined staging older than the retention window (mtime serves
    // as the quarantine timestamp — the journal does not survive the move).
    const quarantineRoot = path.join(this.root, "staging-quarantine");
    if (this.fs.existsSync(quarantineRoot)) {
      for (const id of this.fs.readdirSync(quarantineRoot)) {
        try {
          const entry = path.join(quarantineRoot, id);
          let mtime: number;
          try {
            mtime = this.fs.statSync(entry).mtimeMs ?? 0;
          } catch {
            continue;
          }
          if (this.now() - mtime > effectiveRetention) {
            this.fs.rmSync(entry, { recursive: true, force: true });
            removed += 1;
          }
        } catch {
          continue;
        }
      }
    }

    // 3. Journals whose transient data is fully gone and that are past the
    // retention window: the journal exists for honest re-poll resolution and
    // as the aging key for retained staging — once both staging and
    // quarantine are gone it is pure residue.
    const journalDir = path.join(this.root, "journal");
    if (this.fs.existsSync(journalDir)) {
      for (const name of this.fs.readdirSync(journalDir)) {
        if (!name.endsWith(".json")) continue;
        try {
          const journalPath = path.join(journalDir, name);
          const parsed = JSON.parse(
            this.fs.readFileSync(journalPath)
          ) as { at?: string };
          const createdAt =
            typeof parsed?.at === "string" ? Date.parse(parsed.at) : NaN;
          const stamp = Number.isFinite(createdAt)
            ? createdAt
            : (this.fs.statSync(journalPath).mtimeMs ?? 0);
          if (this.now() - stamp <= effectiveRetention) continue;
          const stagingPath = path.join(
            this.root,
            "staging",
            name.replace(/\.json$/, "")
          );
          const quarantinePath = path.join(
            quarantineRoot,
            name.replace(/\.json$/, "")
          );
          if (
            !this.fs.existsSync(stagingPath) &&
            !this.fs.existsSync(quarantinePath)
          ) {
            this.fs.unlinkSync(journalPath);
            removed += 1;
          }
        } catch {
          continue;
        }
      }
    }

    return removed;
  }

  /**
   * Confirmed conversation deletion (B12): remove every promoted artifact
   * owned by the conversation. Called Module-side from the conversation
   * clear/delete flows; staging/quarantine are NOT conversation-owned —
   * they follow the normal startup/periodic aging sweeps.
   */
  public removeForConversation(conversationId: string): number {
    let removed = 0;
    const artifactsRoot = path.join(this.root, "artifacts");
    if (!this.fs.existsSync(artifactsRoot)) return 0;
    for (const id of this.fs.readdirSync(artifactsRoot)) {
      try {
        const artifact = this.readArtifact(path.join(artifactsRoot, id));
        if (artifact && artifact.conversationId === conversationId) {
          this.fs.rmSync(path.join(artifactsRoot, id), {
            recursive: true,
            force: true,
          });
          removed += 1;
        }
      } catch {
        continue;
      }
    }
    return removed;
  }

  // ----------------------------------------------------------------- helpers

  private validateCandidate(
    staging: string,
    candidate: PluginArtifactCandidate,
    realStaging: string
  ):
    | { file: string; recordCount: number; digest: string }
    | { error: string } {
    // Fixed v1 filename allowlist kept ahead of the filename↔format binding
    // so traversal/renamed paths are rejected by name, never followed.
    if (candidate.relativePath !== "records.json" && candidate.relativePath !== "records.csv") {
      return { error: `candidate path "${candidate.relativePath}" is not allowed` };
    }
    // Bind filename ↔ format (B10): "records.csv" + format:json (or the
    // reverse) can never be registered by claiming a mismatched pair.
    const expectedFormat: PluginArtifactFormat =
      candidate.relativePath === "records.json" ? "json" : "csv";
    if (candidate.format !== expectedFormat) {
      return {
        error: `filename/format mismatch for "${candidate.relativePath}" (declared format ${candidate.format})`,
      };
    }
    const resolved = path.resolve(staging, candidate.relativePath);
    // Validate the ORIGINAL filesystem entry before following anything (B10).
    let originalStat: ReturnType<ArtifactFs["lstatSync"]>;
    try {
      originalStat = this.fs.lstatSync(resolved);
    } catch {
      return { error: `candidate "${candidate.relativePath}" does not exist` };
    }
    if (originalStat.isSymbolicLink() || !originalStat.isFile()) {
      return { error: `candidate "${candidate.relativePath}" is not a regular file` };
    }
    let real: string;
    try {
      real = this.fs.realpathSync(resolved);
    } catch {
      return { error: `candidate "${candidate.relativePath}" does not exist` };
    }
    if (real !== realStaging && !real.startsWith(`${realStaging}${path.sep}`)) {
      return { error: `candidate "${candidate.relativePath}" escapes the staging directory` };
    }
    // Re-validate the fully resolved path: directories or the entry itself
    // could have been swapped between lstat and realpath.
    try {
      const lstat = this.fs.lstatSync(real);
      if (lstat.isSymbolicLink() || !lstat.isFile()) {
        return { error: `candidate "${candidate.relativePath}" is not a regular file` };
      }
    } catch {
      return { error: `candidate "${candidate.relativePath}" is not a regular file` };
    }
    const stat = this.fs.statSync(real);
    if (stat.size > this.limits.maxArtifactBytes) {
      return { error: `candidate "${candidate.relativePath}" exceeds the size cap` };
    }
    if (typeof stat.nlink === "number" && stat.nlink > 1) {
      return { error: `candidate "${candidate.relativePath}" has multiple hard links` };
    }

    // G03 streaming validation: `scanCandidateFile` walks the file through
    // bounded positional chunk reads, feeding the format validator AND the
    // sha256 digest simultaneously — no full-file Buffer, no 100 MiB string
    // parse, and no second read pass for the digest.
    const scanned = this.scanCandidateFile(real, candidate.format === "json");
    if ("error" in scanned) {
      return {
        error: `candidate "${candidate.relativePath}": ${scanned.error}`,
      };
    }
    if (
      candidate.format === "json" &&
      scanned.recordCount !== candidate.recordCount
    ) {
      return {
        error: `record count mismatch for "${candidate.relativePath}" (claimed ${candidate.recordCount}, found ${scanned.recordCount})`,
      };
    }
    if (
      candidate.format === "csv" &&
      scanned.recordCount !== candidate.recordCount
    ) {
      return {
        error: `record count mismatch for "${candidate.relativePath}" (claimed ${candidate.recordCount}, found ${scanned.recordCount})`,
      };
    }
    return { file: real, recordCount: scanned.recordCount, digest: scanned.digest };
  }

  /**
   * G03: bounded-memory scan of a candidate file — chunked positional reads
   * (≤ scanChunkBytes) feed a streaming CSV/JSON validator and an incremental
   * sha256 over the exact content bytes. Stop scanning as soon as validation
   * fails.
   */
  private scanCandidateFile(
    file: string,
    json: boolean
  ): { recordCount: number; digest: string } | { error: string } {
    const jsonValidator = json ? new JsonArtifactValidationState() : null;
    const csvValidator = json ? null : new CsvArtifactValidationState();
    const decoder = new Utf8ChunkDecoder();
    const hash = createHash("sha256");
    const chunkSize = this.limits.scanChunkBytes;
    let offset = 0;
    for (;;) {
      let chunk: Buffer;
      try {
        chunk = this.fs.readChunkAtSync(file, offset, chunkSize);
      } catch (e) {
        return { error: `scan failed: ${String(e)}` };
      }
      if (chunk.length === 0) break;
      hash.update(chunk);
      const text = decoder.decode(chunk);
      if (jsonValidator) jsonValidator.consume(text);
      else if (csvValidator) csvValidator.consume(text);
      // Fail fast — a malformed file stops the scan immediately.
      const failedNow = jsonValidator
        ? jsonValidator.failed()
        : csvValidator
          ? csvValidator.failed
          : false;
      if (failedNow) {
        const verdict = jsonValidator
          ? jsonValidator.finish()
          : (csvValidator as CsvArtifactValidationState).finish();
        return { error: verdict.ok ? "invalid file" : verdict.error };
      }
      offset += chunk.length;
      if (chunk.length < chunkSize) break;
    }
    if (jsonValidator) {
      const verdict = jsonValidator.finish();
      if (!verdict.ok) return { error: verdict.error };
      return { recordCount: verdict.recordCount, digest: hash.digest("hex") };
    }
    if (csvValidator) {
      const verdict = csvValidator.finish();
      if (!verdict.ok) return { error: verdict.error };
      return { recordCount: verdict.dataRecords, digest: hash.digest("hex") };
    }
    return { error: "unknown validator" };
  }

  private requireOwned(
    artifactId: string,
    conversationId: string
  ): RegisteredPluginArtifact | null {
    this.assertSafeComponent(artifactId);
    const artifact = this.readArtifact(
      path.join(this.root, "artifacts", artifactId)
    );
    if (!artifact) return null;
    if (artifact.conversationId !== conversationId) return null;
    // B12: expired metadata never serves content between sweeps — reads
    // reject it so retention holds even before the next sweep runs.
    if (artifact.expiresAt <= new Date(this.now()).toISOString()) return null;
    return artifact;
  }

  private readArtifact(dir: string): RegisteredPluginArtifact | null {
    const metaPath = path.join(dir, "metadata.json");
    if (!this.fs.existsSync(metaPath)) return null;
    try {
      const parsed = JSON.parse(
        this.fs.readBufferSync(metaPath).toString("utf8")
      ) as {
        id?: unknown;
        conversationId?: unknown;
        digest?: unknown;
        format?: unknown;
        recordCount?: unknown;
        sizeBytes?: unknown;
        createdAt?: unknown;
        expiresAt?: unknown;
        pluginName?: unknown;
        schemaVersion?: unknown;
        executionId?: unknown;
        mimeType?: unknown;
        userScopeId?: unknown;
        status?: unknown;
        pluginVersion?: unknown;
        pluginGeneration?: unknown;
      };
      if (
        typeof parsed.id === "string" &&
        typeof parsed.conversationId === "string"
      ) {
        // G03: normalize metadata written by pre-G03 hosts so every consumer
        // can rely on the identity/state fields (legacy entries get the
        // values the host can prove; unknowns stay honest/default).
        const format = parsed.format === "csv" ? "csv" : "json";
        return {
          ...(parsed as RegisteredPluginArtifact),
          format,
          schemaVersion: 1,
          executionId:
            typeof parsed.executionId === "string" ? parsed.executionId : "",
          mimeType:
            typeof parsed.mimeType === "string"
              ? parsed.mimeType
              : format === "csv"
                ? "text/csv"
                : "application/json",
          userScopeId: typeof parsed.userScopeId === "string" ? parsed.userScopeId : this.scopeId,
          status: this.parseArtifactStatus(parsed.status),
          ...(typeof parsed.pluginVersion === "string"
            ? { pluginVersion: parsed.pluginVersion }
            : {}),
          ...(typeof parsed.pluginGeneration === "string"
            ? { pluginGeneration: parsed.pluginGeneration }
            : {}),
        };
      }
    } catch {
      /* corrupt metadata → treat as absent */
    }
    return null;
  }

  private parseArtifactStatus(value: unknown): PluginArtifactStatus {
    return value === "complete" || value === "degraded" || value === "interrupted"
      ? value
      : "complete";
  }

  private deriveArtifactId(
    executionId: string,
    candidate: PluginArtifactCandidate
  ): string {
    const hash = createHash("sha256")
      .update(executionId)
      .update(" ")
      .update(candidate.relativePath)
      .digest("hex")
      .slice(0, 12);
    return `pa_${hash}`;
  }

  /**
   * Journal payload (G03): status + owner identity + artifacts + errors.
   * A journal with ZERO artifacts is NOT an active promise — startup treats
   * mere journal existence as promotion is precisely the bug this fixes.
   */
  private writeJournal(
    executionId: string,
    entry: {
      status?: string;
      artifacts: RegisteredPluginArtifact[];
      errors: string[];
      conversationId?: string | null;
      pluginName?: string | null;
    }
  ): void {
    try {
      this.assertSafeComponent(executionId);
      const journalDir = path.join(this.root, "journal");
      this.fs.mkdirSync(journalDir, { recursive: true });
      const payload = {
        at: new Date(this.now()).toISOString(),
        status: entry.status ?? (entry.artifacts.length > 0 ? "complete" : "failed"),
        conversationId: entry.conversationId ?? null,
        pluginName: entry.pluginName ?? null,
        artifacts: entry.artifacts,
        errors: entry.errors.slice(0, 16),
      };
      // Crash-safe: write to a temp file and ATOMICALLY rename (a half-written
      // journal is never observable as a promoted state).
      const tmp = path.join(journalDir, `${executionId}.json.tmp`);
      this.fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
      this.fs.renameSync(tmp, path.join(journalDir, `${executionId}.json`));
    } catch (e) {
      log.warn(`[PluginFileArtifactService] journal write failed: ${String(e)}`);
    }
  }

  /** Normalized, defensive journal read (legacy entries get defaults). */
  private readJournalFile(journalPath: string): {
    status: string;
    at: string | null;
    conversationId: string | null;
    pluginName: string | null;
    registeredCount: number;
    message: string | null;
  } | null {
    if (!this.fs.existsSync(journalPath)) return null;
    try {
      const parsed = JSON.parse(
        this.fs.readBufferSync(journalPath).toString("utf8")
      ) as {
        at?: unknown;
        status?: unknown;
        conversationId?: unknown;
        pluginName?: unknown;
        errors?: unknown;
        artifacts?: unknown;
      };
      const artifacts = Array.isArray(parsed.artifacts)
        ? (parsed.artifacts as unknown[]).filter(
            (a): a is RegisteredPluginArtifact =>
              !!a && typeof a === "object" && typeof (a as Record<string, unknown>).id === "string"
          )
        : [];
      const errors = Array.isArray(parsed.errors)
        ? (parsed.errors as unknown[]).filter(
            (m): m is string => typeof m === "string"
          )
        : [];
      const at = typeof parsed.at === "string" ? parsed.at : null;
      return {
        status: typeof parsed.status === "string" ? parsed.status : artifacts.length > 0 ? "complete" : "failed",
        at,
        conversationId:
          typeof parsed.conversationId === "string" ? parsed.conversationId : null,
        pluginName: typeof parsed.pluginName === "string" ? parsed.pluginName : null,
        registeredCount: artifacts.length,
        message: errors[0] ?? null,
      };
    } catch {
      return null;
    }
  }

  private assertSafeComponent(value: string): void {
    if (
      value.length === 0 ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("..") ||
      value.includes("\0")
    ) {
      throw new Error(`unsafe artifact path component: ${value}`);
    }
  }
}

/**
 * Resolve the artifact-store scope from the AUTHENTICATED host identity
 * (Token `user_id`, hashed — B09). The scoped service cache means an account
 * change immediately redirects all reads/writes to that account's own store;
 * previous-account content keeps its separate on-disk scope and is never
 * reachable through the new identity without the host re-deriving it.
 */
export function resolvePluginArtifactScopeId(): string {
  let userId = "";
  try {
    userId = new Token().getValue(USERID) ?? "";
  } catch {
    userId = "";
  }
  const normalized = userId.trim();
  if (normalized.length === 0) return "anonymous";
  return `u_${createHash("sha256")
    .update("aifetchly-plugin-artifacts:1:")
    .update(normalized)
    .digest("hex")
    .slice(0, 16)}`;
}

const MAX_CACHED_SCOPED_SERVICES = 8;
const scopedServices = new Map<string, PluginFileArtifactService>();

export function getPluginFileArtifactService(
  scopeId?: string
): PluginFileArtifactService {
  const scope = scopeId ?? resolvePluginArtifactScopeId();
  const cached = scopedServices.get(scope);
  if (cached) return cached;
  const service = new PluginFileArtifactService({ scopeId: scope });
  if (scopedServices.size >= MAX_CACHED_SCOPED_SERVICES) {
    const oldest = scopedServices.keys().next();
    if (!oldest.done) scopedServices.delete(oldest.value);
  }
  scopedServices.set(scope, service);
  return service;
}

/** Fresh unique execution id (host-generated). */
export function newArtifactExecutionId(): string {
  return `exec_${randomUUID()}`;
}
