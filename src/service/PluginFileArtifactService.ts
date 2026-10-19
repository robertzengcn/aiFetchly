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
}

export const PLUGIN_ARTIFACT_LIMITS = {
  /** Max bytes of one finalized artifact file. */
  maxArtifactBytes: 100 * 1024 * 1024,
  /** Max finalized artifacts per execution. */
  maxArtifactsPerExecution: 2,
  /** Default retention for unexported completed artifacts. */
  defaultRetentionMs: 30 * 24 * 60 * 60_000,
  /** Max bytes of a candidates.json manifest read by the host (B10). */
  maxCandidatesManifestBytes: 1024 * 1024,
} as const;

/** Structural fs seam for tests. */
export interface ArtifactFs {
  existsSync(p: string): boolean;
  statSync(p: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    /** Hard-link count when the underlying fs exposes it (real fs does). */
    nlink?: number;
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
  unlinkSync(p: string): void;
  rmSync(p: string, options?: { recursive: boolean; force: boolean }): void;
  renameSync(from: string, to: string): void;
}

function defaultFs(): ArtifactFs {
  return {
    ...fs,
    readBufferSync: (p: string) => fs.readFileSync(p) as Buffer,
  } as unknown as ArtifactFs;
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
  let logicalRecords = 0;
  let recordHasContent = false;
  let inQuotes = false;
  /** True between the opening quote and the first quoted content char. */
  let insideOpeningQuote = false;
  /** True immediately after a closing quote (RFC 4180 delimiter must follow). */
  let afterClosingQuote = false;
  let atCellStart = true;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // tolerate a BOM
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (insideOpeningQuote) {
        insideOpeningQuote = false;
        if (CSV_RISKY_LEADING_CHARS.has(ch)) {
          return {
            ok: false,
            error: "spreadsheet-formula-like cell (must be neutralized by the plugin)",
          };
        }
      }
      if (ch === '"') {
        if (text[i + 1] === '"') {
          i += 2;
          continue;
        }
        inQuotes = false;
        afterClosingQuote = true;
        i += 1;
        continue;
      }
      recordHasContent = true;
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (afterClosingQuote) {
      if (ch === ",") {
        atCellStart = true;
        afterClosingQuote = false;
        i += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        afterClosingQuote = false;
        // fall through to the record-end handling below without consuming.
      } else {
        return { ok: false, error: "unexpected characters after a closing quote" };
      }
    }
    if (atCellStart && ch === '"') {
      inQuotes = true;
      insideOpeningQuote = true;
      atCellStart = false;
      recordHasContent = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      atCellStart = true;
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      logicalRecords += 1;
      recordHasContent = false;
      atCellStart = true;
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (atCellStart && CSV_RISKY_LEADING_CHARS.has(ch)) {
      return {
        ok: false,
        error: "spreadsheet-formula-like cell (must be neutralized by the plugin)",
      };
    }
    atCellStart = false;
    recordHasContent = true;
    i += 1;
  }
  if (inQuotes) {
    return { ok: false, error: "unterminated quoted field in CSV" };
  }
  let logicalFinal = logicalRecords;
  if (recordHasContent) logicalFinal += 1;
  if (logicalFinal === 0) return { ok: true, dataRecords: 0 };
  // Record 1 is always the fixed header row.
  return { ok: true, dataRecords: Math.max(0, logicalFinal - 1) };
}

/**
 * Validate a v1 JSON artifact document (design §13.3): an object with
 * schemaVersion 1, a REQUIRED `records` array, and object records. A missing
 * records array must never masquerade as an empty dataset (B10).
 */
export function validatePluginArtifactJsonDoc(
  text: string
): { ok: true; recordCount: number } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "JSON artifact must be an object with a records array" };
  }
  const doc = parsed as Record<string, unknown>;
  if (!Array.isArray(doc.records)) {
    return { ok: false, error: "JSON artifact is missing the records array" };
  }
  const schemaVersion = doc.schemaVersion;
  if (
    typeof schemaVersion !== "number" ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion !== 1
  ) {
    return { ok: false, error: "unsupported JSON artifact schemaVersion" };
  }
  for (const record of doc.records as unknown[]) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { ok: false, error: "JSON artifact records must be objects" };
    }
  }
  return { ok: true, recordCount: doc.records.length };
}

export class PluginFileArtifactService {
  private readonly root: string;
  private readonly fs: ArtifactFs;
  private readonly now: () => number;

  constructor(
    options?: { root?: string; scopeId?: string; fs?: ArtifactFs },
    now?: () => number
  ) {
    this.root =
      options?.root ??
      path.join(
        getElectronUserDataPath(),
        "plugin-artifacts",
        options?.scopeId ?? "default"
      );
    this.fs = options?.fs ?? defaultFs();
    this.now = now ?? Date.now;
  }

  // ------------------------------------------------------------------ staging

  /** Provision (idempotently) the per-execution staging directory. */
  public provisionStaging(executionId: string): string {
    const dir = this.stagingDir(executionId);
    this.fs.mkdirSync(dir, { recursive: true });
    return dir;
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
          PLUGIN_ARTIFACT_LIMITS.maxCandidatesManifestBytes
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
   *  - No journal (promotion never happened): write an `interrupted` journal
   *    entry so a conversation re-polling for the artifact gets an honest
   *    resolution, then move the orphan staging dir into `staging-quarantine`
   *    (plugin-owned bytes are never deleted directly — a human may inspect
   *    them; the monitor sweeps quarantine by the same retention window).
   *  - Journal exists but the staging dir was retained after promotion:
   *    age out (remove) once the journal is older than the retention
   *    window (default 30 days).
   *
   * Runs BEFORE any plugin can start (background.ts whenReady), so races
   * with live executions are impossible.
   */
  public recoverStartupExecutions(
    retentionMs: number = PLUGIN_ARTIFACT_LIMITS.defaultRetentionMs
  ): { interrupted: string[]; agedPromotedStaging: string[] } {
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
      const promoted = this.fs.existsSync(journalPath);
      if (!promoted) {
        try {
          this.writeJournal(id, {
            artifacts: [],
            errors: [
              `interrupted: host restart before promotion (startup sweep at ${new Date(
                this.now()
              ).toISOString()})`,
            ],
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
        const parsed = JSON.parse(
          this.fs.readFileSync(journalPath)
        ) as { at?: string };
        const at = typeof parsed?.at === "string" ? Date.parse(parsed.at) : NaN;
        if (
          Number.isFinite(at) &&
          this.now() - at > retentionMs &&
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
      input.candidates.length > PLUGIN_ARTIFACT_LIMITS.maxArtifactsPerExecution
    ) {
      // The promote loop below slices to the cap; a candidate beyond it is
      // only reported as dropped (the previous dead `slice(...)` call was
      // discarded by callers AND by the loop).
      errors.push(
        `too many candidates; only the first ${PLUGIN_ARTIFACT_LIMITS.maxArtifactsPerExecution} are considered`
      );
    }

    for (const candidate of input.candidates.slice(
      0,
      PLUGIN_ARTIFACT_LIMITS.maxArtifactsPerExecution
    )) {
      const validated = this.validateCandidate(staging, candidate, realStaging);
      if ("error" in validated) {
        errors.push(validated.error);
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
        // Host-authoritative digest over the promoted bytes (design §13.2).
        const digest = createHash("sha256")
          .update(this.fs.readBufferSync(contentPath))
          .digest("hex");
        const registered: RegisteredPluginArtifact = {
          id: artifactId,
          format: candidate.format,
          recordCount: validated.recordCount,
          sizeBytes: stat.size,
          createdAt: new Date(this.now()).toISOString(),
          expiresAt: new Date(
            this.now() + PLUGIN_ARTIFACT_LIMITS.defaultRetentionMs
          ).toISOString(),
          conversationId: input.conversationId,
          pluginName: input.pluginName,
          digest,
        };
        // Atomic metadata write: metadata is authoritative only after the
        // content copy completed.
        const metaTmp = path.join(destDir, "metadata.json.tmp");
        this.fs.writeFileSync(metaTmp, JSON.stringify(registered), {
          mode: 0o600,
        });
        this.fs.renameSync(metaTmp, path.join(destDir, "metadata.json"));
        artifacts.push(registered);
      } catch (e) {
        errors.push(`promotion failed for ${candidate.relativePath}: ${String(e)}`);
      }
    }

    this.writeJournal(input.executionId, { artifacts, errors });
    return { artifacts, errors };
  }

  // ------------------------------------------------------------- consumption

  /** List artifacts for a conversation (ownership-scoped). */
  public listForConversation(
    conversationId: string
  ): RegisteredPluginArtifact[] {
    const out: RegisteredPluginArtifact[] = [];
    const artifactsRoot = path.join(this.root, "artifacts");
    if (!this.fs.existsSync(artifactsRoot)) return out;
    for (const id of this.fs.readdirSync(artifactsRoot)) {
      const artifact = this.readArtifact(path.join(artifactsRoot, id));
      if (artifact && artifact.conversationId === conversationId) {
        out.push(artifact);
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Bounded preview: JSON → first `maxRows` records; CSV → first `maxRows`
   * lines. Never returns unbounded content to the model/renderer.
   */
  public preview(
    conversationId: string,
    artifactId: string,
    maxRows = 5
  ): { ok: true; format: PluginArtifactFormat; rows: string } | { ok: false; error: string } {
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
    const text = this.fs.readBufferSync(contentPath).toString("utf8");
    if (artifact.format === "csv") {
      const lines = text.split("\n").slice(0, maxRows + 1); // header + rows
      return { ok: true, format: "csv", rows: lines.join("\n") };
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)) {
        const records = (parsed as { records: unknown[] }).records.slice(0, maxRows);
        return {
          ok: true,
          format: "json",
          rows: JSON.stringify({ ...parsed, records } as Record<string, unknown>),
        };
      }
      return { ok: true, format: "json", rows: text.slice(0, 16 * 1024) };
    } catch {
      return { ok: false, error: "artifact content is not valid JSON" };
    }
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

  /** Expire artifacts past their retention (startup / periodic sweep). */
  public sweepExpired(): number {
    let removed = 0;
    const artifactsRoot = path.join(this.root, "artifacts");
    if (!this.fs.existsSync(artifactsRoot)) return 0;
    const nowIso = new Date(this.now()).toISOString();
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
    return removed;
  }

  // ----------------------------------------------------------------- helpers

  private validateCandidate(
    staging: string,
    candidate: PluginArtifactCandidate,
    realStaging: string
  ):
    | { file: string; recordCount: number }
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
    if (stat.size > PLUGIN_ARTIFACT_LIMITS.maxArtifactBytes) {
      return { error: `candidate "${candidate.relativePath}" exceeds the size cap` };
    }
    if (typeof stat.nlink === "number" && stat.nlink > 1) {
      return { error: `candidate "${candidate.relativePath}" has multiple hard links` };
    }
    const text = this.fs.readBufferSync(real).toString("utf8");
    if (candidate.format === "json") {
      const validation = validatePluginArtifactJsonDoc(text);
      if (!validation.ok) {
        return { error: `candidate "${candidate.relativePath}": ${validation.error}` };
      }
      if (validation.recordCount !== candidate.recordCount) {
        return {
          error: `record count mismatch for "${candidate.relativePath}" (claimed ${candidate.recordCount}, found ${validation.recordCount})`,
        };
      }
      return { file: real, recordCount: validation.recordCount };
    }
    const csv = validatePluginArtifactCsvText(text);
    if (!csv.ok) {
      return { error: `candidate "${candidate.relativePath}": ${csv.error}` };
    }
    if (csv.dataRecords !== candidate.recordCount) {
      return {
        error: `record count mismatch for "${candidate.relativePath}" (claimed ${candidate.recordCount}, found ${csv.dataRecords})`,
      };
    }
    return { file: real, recordCount: csv.dataRecords };
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
    return artifact.conversationId === conversationId ? artifact : null;
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
      };
      if (
        typeof parsed.id === "string" &&
        typeof parsed.conversationId === "string" &&
        (parsed.digest === undefined || typeof parsed.digest === "string")
      ) {
        return parsed as RegisteredPluginArtifact;
      }
    } catch {
      /* corrupt metadata → treat as absent */
    }
    return null;
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

  private writeJournal(
    executionId: string,
    entry: { artifacts: RegisteredPluginArtifact[]; errors: string[] }
  ): void {
    try {
      const journalDir = path.join(this.root, "journal");
      this.fs.mkdirSync(journalDir, { recursive: true });
      this.fs.writeFileSync(
        path.join(journalDir, `${executionId}.json`),
        JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry })
      );
    } catch (e) {
      log.warn(`[PluginFileArtifactService] journal write failed: ${String(e)}`);
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
