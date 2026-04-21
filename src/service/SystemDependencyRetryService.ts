/**
 * Retry orchestration for skills that fail due to missing system dependencies.
 *
 * Flow: detect missing_system_tool → resolve → [user approval] → install → retry skill once.
 *
 * Phase 1 (resolveOnly): Diagnose + resolve — no side effects, returns recommendation.
 * Phase 2 (installAndRetry): Called ONLY after user approves via DependencyInstallDialog.
 */

import { SkillDiagnosticsService } from "@/service/SkillDiagnosticsService";
import { SystemDependencyModule } from "@/modules/SystemDependencyModule";
import { SkillExecutor } from "@/service/SkillExecutor";
import { SkillRegistry } from "@/config/skillsRegistry";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import type {
  InstallResultData,
  ResolveSystemDependencyOutput,
} from "@/entityTypes/systemDependencyTypes";
import type { ToolExecutionResult } from "@/api/aiChatApi";

export interface RetryContext {
  readonly toolName: string;
  readonly toolParams: Record<string, unknown>;
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly stderr: string;
  readonly manifest?: SkillManifest;
}

export interface RetryResult {
  /** Whether a retry was attempted. */
  readonly retried: boolean;
  /** Whether the retry succeeded. */
  readonly retrySuccess: boolean;
  /** The result of the retry execution, if attempted. */
  readonly retryResult: ToolExecutionResult | null;
  /** Install result, if an install was attempted. */
  readonly installResult: InstallResultData | null;
  /** Resolved dependency ID, if any. */
  readonly dependencyId: string | null;
  /** Human-readable status message. */
  readonly message: string;
}

/** Result of the resolve-only phase (before user approval). */
export interface ResolveOnlyResult {
  /** Whether the error is a system dependency issue. */
  readonly isDependencyError: boolean;
  /** The advisory resolution, if identified. */
  readonly resolution: ResolveSystemDependencyOutput | null;
  /** Human-readable status message. */
  readonly message: string;
}

/**
 * Service that orchestrates the self-healing retry loop.
 *
 * Split into two phases to enforce FR-006 (user approval gate):
 *
 * Phase 1 — resolveOnly: Diagnose stderr → classify → resolve against catalog.
 *   No side effects. Returns a recommendation for the UI to show the user.
 *
 * Phase 2 — installAndRetry: Called ONLY after the user explicitly approves.
 *   Installs the dependency and retries the skill execution once.
 */
export const SystemDependencyRetryService = {
  /**
   * Phase 1: Diagnose and resolve WITHOUT installing.
   *
   * Returns a recommendation to present to the user for approval.
   */
  resolveOnly(context: RetryContext): ResolveOnlyResult {
    const diagnosis = SkillDiagnosticsService.diagnoseStderr(
      context.stderr,
      context.manifest
    );

    if (diagnosis.cause !== "missing_system_tool" || !diagnosis.dependency_id) {
      return {
        isDependencyError: false,
        resolution: null,
        message: `Not a system dependency error: ${diagnosis.cause}`,
      };
    }

    const mod = new SystemDependencyModule();
    const resolution = mod.resolve(
      {
        stderr: context.stderr,
        manifest: context.manifest,
        platform: process.platform,
      },
      {
        conversation_id: context.conversationId,
        skill_name: context.toolName,
      }
    );

    if (!resolution.resolved || !resolution.dependency_id) {
      return {
        isDependencyError: false,
        resolution: null,
        message: resolution.reason,
      };
    }

    return {
      isDependencyError: true,
      resolution,
      message: resolution.reason,
    };
  },

  /**
   * Phase 2: Install a user-approved dependency and retry the skill.
   *
   * MUST only be called after the user explicitly approves via
   * DependencyInstallDialog (enforces FR-006).
   */
  async installAndRetry(
    dependencyId: string,
    reason: string,
    context: RetryContext
  ): Promise<RetryResult> {
    const mod = new SystemDependencyModule();

    // Install the approved dependency
    const installResult = await mod.install({
      dependency_id: dependencyId,
      reason,
      conversation_id: context.conversationId,
      skill_name: context.toolName,
    });

    if (!installResult.should_retry) {
      return {
        retried: false,
        retrySuccess: false,
        retryResult: null,
        installResult,
        dependencyId,
        message: `Install completed with status "${installResult.install_status}", retry not recommended.`,
      };
    }

    // Retry skill execution once
    if (!SkillRegistry.isRegistered(context.toolName)) {
      return {
        retried: false,
        retrySuccess: false,
        retryResult: null,
        installResult,
        dependencyId,
        message: `Tool "${context.toolName}" is not a registered skill, cannot retry.`,
      };
    }

    const retryResult: ToolExecutionResult = await SkillExecutor.execute(
      context.toolName,
      context.toolParams,
      {
        conversationId: context.conversationId,
        toolCallId: context.toolCallId,
      }
    );

    return {
      retried: true,
      retrySuccess: retryResult.success,
      retryResult,
      installResult,
      dependencyId,
      message: retryResult.success
        ? `Successfully retried "${context.toolName}" after installing "${dependencyId}".`
        : `Retry of "${context.toolName}" failed after installing "${dependencyId}".`,
    };
  },
} as const;
