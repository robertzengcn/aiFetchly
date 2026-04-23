/**
 * Business logic orchestrator for system dependency installation.
 *
 * Coordinates the resolve, install, and audit lifecycle.
 * Extends BaseModule for database path resolution.
 */

import { BaseModule } from "./baseModule";
import { SystemDependencyResolver } from "@/service/SystemDependencyResolver";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";
import { SystemDependencyAuditLogger } from "@/service/SystemDependencyAuditLogger";
import { SystemDependencyInstaller } from "@/service/SystemDependencyInstaller";
import type {
  ResolveSystemDependencyInput,
  ResolveSystemDependencyOutput,
  InstallSystemDependencyRequest,
  InstallResultData,
  GetAuditLogRequest,
  GetAuditLogResponse,
  AuditLogEntry,
  DependencyPlatform,
} from "@/entityTypes/systemDependencyTypes";

import catalogJson from "@/config/dependency-catalog.json";

/**
 * Module that orchestrates system dependency operations.
 *
 * Provides resolve (advisory) and install (side-effect) methods,
 * plus audit query. Follows the three-layer architecture:
 * Module (business logic) → Service (operations) → Model (data access).
 */
export class SystemDependencyModule extends BaseModule {
  private readonly resolver: SystemDependencyResolver;
  private readonly auditLogger: SystemDependencyAuditLogger;
  private readonly installer: SystemDependencyInstaller;
  private readonly catalog: SystemDependencyCatalog;

  constructor() {
    super();
    const catalog = new SystemDependencyCatalog(
      loadCatalogFromConfig(catalogJson)
    );
    this.catalog = catalog;
    this.resolver = new SystemDependencyResolver(catalog);
    this.auditLogger = new SystemDependencyAuditLogger(this.dbpath);
    this.installer = new SystemDependencyInstaller(
      catalog,
      SystemDependencyModule.getPlatform()
    );
  }

  /**
   * Advisory resolution — no side effects beyond audit logging.
   *
   * Takes error output and returns a structured recommendation
   * with confidence scoring. Never triggers installation.
   * Logs resolved dependencies to audit trail.
   */
  resolve(
    input: ResolveSystemDependencyInput,
    context?: { conversation_id?: string; skill_name?: string }
  ): ResolveSystemDependencyOutput {
    const result = this.resolver.resolve(input);

    // Audit log when resolution succeeds and context is available
    if (result.resolved && context?.conversation_id && result.dependency_id) {
      this.auditLogger
        .logAction({
          conversation_id: context.conversation_id,
          skill_name: context.skill_name ?? "unknown",
          dependency_id: result.dependency_id,
          missing_binary: result.missing_binary ?? result.dependency_id,
          suggested_by_ai: true,
          user_decision: "suggested", // resolve is the AI suggestion phase
          installer_backend: null,
          package_name: null,
          execution_status: null,
          execution_duration_ms: null,
          stderr: null,
        })
        .catch((err: unknown) => {
          console.error("Failed to write resolve audit log:", err);
        });
    }

    return result;
  }

  /**
   * Execute a validated dependency installation.
   *
   * Validates dependency_id against catalog, runs the install
   * via SystemDependencyInstaller, logs the action, and returns
   * a typed result with should_retry flag.
   */
  async install(
    request: InstallSystemDependencyRequest
  ): Promise<InstallResultData> {
    const { dependency_id, reason, conversation_id, skill_name } = request;
    const catalogEntry = this.catalog.getById(dependency_id);
    const missingBinary = catalogEntry?.probe ?? dependency_id;
    const platformCandidate = this.catalog.getPlatformCandidate(
      dependency_id,
      SystemDependencyModule.getPlatform()
    );

    // Execute the install via the installer service
    const result = this.installer.install(dependency_id);

    // Log the action (approved or failed)
    await this.auditLogger.logAction({
      conversation_id,
      skill_name,
      dependency_id,
      missing_binary: missingBinary,
      suggested_by_ai: true,
      user_decision: "approved",
      installer_backend: platformCandidate?.manager ?? null,
      package_name: platformCandidate?.package ?? null,
      execution_status: result.status,
      execution_duration_ms: result.durationMs,
      stderr: result.stderr || null,
    });

    return {
      install_status: result.status,
      dependency_id,
      probe: missingBinary,
      details: reason
        ? `${result.details} (reason: ${reason})`
        : result.details,
      should_retry: result.shouldRetry,
    };
  }

  /**
   * Query audit log entries with optional filters.
   */
  async getAuditLog(params: GetAuditLogRequest): Promise<GetAuditLogResponse> {
    const model = this.auditLogger.getModel();
    const { entries, total } = await model.getPaginated({
      conversation_id: params.conversation_id,
      dependency_id: params.dependency_id,
      limit: params.limit,
      offset: params.offset,
    });

    const data: AuditLogEntry[] = entries.map((e) => ({
      id: e.id,
      conversation_id: e.conversation_id,
      skill_name: e.skill_name,
      dependency_id: e.dependency_id,
      missing_binary: e.missing_binary,
      suggested_by_ai: e.suggested_by_ai,
      user_decision: e.user_decision as "approved" | "denied" | "suggested",
      installer_backend: e.installer_backend,
      package_name: e.package_name,
      execution_status: e.execution_status as
        | "installed"
        | "already_installed"
        | "permission_denied"
        | "installer_not_found"
        | "unsupported_platform"
        | "path_issue"
        | "installation_failed"
        | null,
      execution_duration_ms: e.execution_duration_ms,
      stderr_sanitized: e.stderr_sanitized,
      created_at: e.createdAt?.toISOString() ?? "",
    }));

    return { status: true, data, total };
  }

  /** Get the platform key for the current OS. */
  static getPlatform(): DependencyPlatform {
    if (process.platform === "darwin") return "darwin";
    if (process.platform === "win32") return "win32";
    return "linux";
  }
}
