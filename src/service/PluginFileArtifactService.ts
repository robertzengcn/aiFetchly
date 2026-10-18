import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { log } from "@/modules/Logger";
import { getElectronUserDataPath } from "@/service/SkillEnvironmentManager";

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
}

export const PLUGIN_ARTIFACT_LIMITS = {
  /** Max bytes of one finalized artifact file. */
  maxArtifactBytes: 100 * 1024 * 1024,
  /** Max finalized artifacts per execution. */
  maxArtifactsPerExecution: 2,
  /** Default retention for unexported completed artifacts. */
  defaultRetentionMs: 30 * 24 * 60 * 60_000,
} as const;

/** Structural fs seam for tests. */
export interface ArtifactFs {
  existsSync(p: string): boolean;
  statSync(p: string): { isFile(): boolean; isDirectory(): boolean; size: number };
  lstatSync(p: string): { isFile(): boolean; isSymbolicLink(): boolean };
  realpathSync(p: string): string;
  mkdirSync(p: string, options?: { recursive: boolean }): string | undefined;
  readdirSync(p: string): string[];
  copyFileSync(from: string, to: string): void;
  writeFileSync(p: string, data: string, options?: { mode: number }): void;
  readFileSync(p: string): string;
  unlinkSync(p: string): void;
  rmSync(p: string, options?: { recursive: boolean; force: boolean }): void;
  renameSync(from: string, to: string): void;
}

function defaultFs(): ArtifactFs {
  return fs as unknown as ArtifactFs;
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
    try {
      parsed = JSON.parse(this.fs.readFileSync(manifest));
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
      const validated = this.validateCandidate(staging, candidate);
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
        const stat = this.fs.statSync(path.join(destDir, contentName));
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
    const text = this.fs.readFileSync(contentPath);
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
    candidate: PluginArtifactCandidate
  ):
    | { file: string; recordCount: number }
    | { error: string } {
    const allowed = new Set(["records.json", "records.csv"]);
    if (!allowed.has(candidate.relativePath)) {
      return { error: `candidate path "${candidate.relativePath}" is not allowed` };
    }
    const resolved = path.resolve(staging, candidate.relativePath);
    const realStaging = this.fs.realpathSync(staging);
    // Containment: realpath must stay inside the staging root; reject
    // symlinks, non-files, and traversal.
    let real: string;
    try {
      real = this.fs.realpathSync(resolved);
    } catch {
      return { error: `candidate "${candidate.relativePath}" does not exist` };
    }
    if (real !== realStaging && !real.startsWith(`${realStaging}${path.sep}`)) {
      return { error: `candidate "${candidate.relativePath}" escapes the staging directory` };
    }
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
    // JSON candidates must parse and their actual record count must match
    // the plugin's claim (the host never trusts plugin assertions).
    if (candidate.format === "json") {
      try {
        const parsed = JSON.parse(this.fs.readFileSync(real)) as {
          records?: unknown[];
        };
        const actual = Array.isArray(parsed.records) ? parsed.records.length : 0;
        if (actual !== candidate.recordCount) {
          return {
            error: `record count mismatch for "${candidate.relativePath}" (claimed ${candidate.recordCount}, found ${actual})`,
          };
        }
      } catch {
        return { error: `candidate "${candidate.relativePath}" is not valid JSON` };
      }
    }
    return { file: real, recordCount: candidate.recordCount };
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
      const parsed = JSON.parse(this.fs.readFileSync(metaPath)) as {
        id?: unknown;
        conversationId?: unknown;
      };
      if (
        typeof parsed.id === "string" &&
        typeof parsed.conversationId === "string"
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

let defaultService: PluginFileArtifactService | undefined;

export function getPluginFileArtifactService(): PluginFileArtifactService {
  if (!defaultService) defaultService = new PluginFileArtifactService();
  return defaultService;
}

export function setPluginFileArtifactServiceForTest(
  service: PluginFileArtifactService | undefined
): void {
  defaultService = service;
}

/** Fresh unique execution id (host-generated). */
export function newArtifactExecutionId(): string {
  return `exec_${randomUUID()}`;
}
