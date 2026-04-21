/**
 * Retry orchestration for skills that fail due to missing system dependencies.
 *
 * Flow: detect missing_system_tool → resolve → install → retry skill once.
 * This service is called from StreamEventProcessor when a skill execution fails
 * with a system dependency error.
 */

import { SkillDiagnosticsService } from "@/service/SkillDiagnosticsService";
import { SystemDependencyModule } from "@/modules/SystemDependencyModule";
import { SkillExecutor } from "@/service/SkillExecutor";
import { SkillRegistry } from "@/config/skillsRegistry";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import type { InstallResultData } from "@/entityTypes/systemDependencyTypes";
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

/**
 * Service that orchestrates the full self-healing retry loop:
 *
 * 1. Diagnose stderr → classify as missing_system_tool
 * 2. Resolve dependency → get catalog match with confidence
 * 3. Install dependency → user-approved, catalog-validated
 * 4. Retry skill once → re-invoke SkillExecutor with original args
 */
export const SystemDependencyRetryService = {
  /**
   * Attempt a self-healing retry for a failed skill execution.
   *
   * Returns a RetryResult indicating what happened. The caller is responsible
   * for sending the result to the renderer and AI server.
   */
  async attemptRetry(context: RetryContext): Promise<RetryResult> {
    // Step 1: Diagnose the error
    const diagnosis = SkillDiagnosticsService.diagnoseStderr(
      context.stderr,
      context.manifest
    );

    if (diagnosis.cause !== "missing_system_tool" || !diagnosis.dependency_id) {
      return {
        retried: false,
        retrySuccess: false,
        retryResult: null,
        installResult: null,
        dependencyId: null,
        message: `Not a system dependency error: ${diagnosis.cause}`,
      };
    }

    // Step 2: Resolve via catalog
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
        retried: false,
        retrySuccess: false,
        retryResult: null,
        installResult: null,
        dependencyId: diagnosis.dependency_id,
        message: resolution.reason,
      };
    }

    // Step 3: Install (user approval happens in UI before this is called)
    const installResult = await mod.install({
      dependency_id: resolution.dependency_id,
      reason: resolution.reason,
      conversation_id: context.conversationId,
      skill_name: context.toolName,
    });

    if (!installResult.should_retry) {
      return {
        retried: false,
        retrySuccess: false,
        retryResult: null,
        installResult,
        dependencyId: resolution.dependency_id,
        message: `Install completed with status "${installResult.install_status}", retry not recommended.`,
      };
    }

    // Step 4: Retry skill execution once
    if (!SkillRegistry.isRegistered(context.toolName)) {
      return {
        retried: false,
        retrySuccess: false,
        retryResult: null,
        installResult,
        dependencyId: resolution.dependency_id,
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
      dependencyId: resolution.dependency_id,
      message: retryResult.success
        ? `Successfully retried "${context.toolName}" after installing "${resolution.dependency_id}".`
        : `Retry of "${context.toolName}" failed after installing "${resolution.dependency_id}".`,
    };
  },
} as const;
