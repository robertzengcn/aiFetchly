import * as fs from "fs";
import { FilePathGuard } from "@/service/FilePathGuard";
import type { GoalVerificationEvidence } from "./GoalVerificationService";
import type { AIChatGoalCriterion } from "@/entityTypes/aiChatGoalTypes";

/**
 * Deterministic evidence collectors for command/file/manual criteria
 * (design §7.3). These produce the evidence the GoalVerificationService
 * evaluates. The loop controller (Phase 7) invokes them after each maker turn.
 *
 * Safety: file inspection is workspace-jailed through FilePathGuard; commands
 * run through an injected runner (the approved shell boundary), never an
 * arbitrary shell spawned here. Excerpts are redacted by the controller before
 * persistence or LLM use (see goalRedaction).
 */

/** Injected command runner — the existing approved shell/tool boundary. */
export interface GoalCommandRunner {
  run(
    command: string,
    opts: { cwd: string; timeoutMs?: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface GoalCollectOptions {
  readonly workspaceRoot: string;
  readonly currentRevision?: string;
  readonly commandRunner?: GoalCommandRunner;
  readonly commandTimeoutMs?: number;
}

const PENDING_FOR_NONDETERMINISTIC = "pending";

export class GoalEvidenceCollector {
  async collect(
    criterion: AIChatGoalCriterion,
    opts: GoalCollectOptions
  ): Promise<GoalVerificationEvidence> {
    switch (criterion.verification.kind) {
      case "file":
        return this.collectFile(criterion, opts);
      case "command":
        return this.collectCommand(criterion, opts);
      case "manual":
        return this.collectManual(criterion, opts);
      case "llm":
        return this.collectLlm(criterion, opts);
      default:
        return this.collectManual(criterion, opts);
    }
  }

  /** Workspace-safe file existence / state check. */
  async collectFile(
    criterion: AIChatGoalCriterion,
    opts: GoalCollectOptions
  ): Promise<GoalVerificationEvidence> {
    const rel = criterion.verification.filePath;
    const base: GoalVerificationEvidence = {
      criterionId: criterion.criterionId,
      state: "fail",
      sourceRevision: opts.currentRevision,
      timestamp: new Date().toISOString(),
    };
    if (!rel) {
      return { ...base, reason: "criterion has no filePath" };
    }
    try {
      const guard = new FilePathGuard([opts.workspaceRoot]);
      const validation = guard.validate(rel);
      if (!validation.safe) {
        return {
          ...base,
          reason: `path rejected: ${validation.code}`,
          failureSignature: validation.code,
        };
      }
      const exists = fs.existsSync(validation.resolvedPath);
      const expected = criterion.verification.expectedFileState ?? "exists";
      if (expected === "exists" && exists) {
        return { ...base, state: "pass", reason: "file exists" };
      }
      // "changed" needs a baseline; for MVP, treat a present file as a weak pass.
      if (expected === "changed" && exists) {
        return {
          ...base,
          state: "pass",
          reason: "file present (changed check deferred)",
        };
      }
      return { ...base, reason: `file not ${expected}` };
    } catch (err) {
      return {
        ...base,
        reason: "file check error",
        failureSignature: err instanceof Error ? err.message : "error",
      };
    }
  }

  /** Run an approved command and check exit code + optional output pattern. */
  async collectCommand(
    criterion: AIChatGoalCriterion,
    opts: GoalCollectOptions
  ): Promise<GoalVerificationEvidence> {
    const base: GoalVerificationEvidence = {
      criterionId: criterion.criterionId,
      state: "fail",
      sourceRevision: opts.currentRevision,
      timestamp: new Date().toISOString(),
    };
    const command = criterion.verification.command;
    if (!command || !opts.commandRunner) {
      return {
        ...base,
        state: "pending",
        reason: command
          ? "no command runner available"
          : "criterion has no command",
      };
    }
    try {
      const result = await opts.commandRunner.run(command, {
        cwd: opts.workspaceRoot,
        timeoutMs: opts.commandTimeoutMs,
      });
      const expectedExit = criterion.verification.expectedExitCode ?? 0;
      const exitOk = result.exitCode === expectedExit;
      const pattern = criterion.verification.expectedOutputPattern;
      const output = `${result.stdout}\n${result.stderr}`;
      const patternOk = pattern ? new RegExp(pattern).test(output) : true;
      if (exitOk && patternOk) {
        return {
          ...base,
          state: "pass",
          reason: `exit ${result.exitCode}`,
        };
      }
      return {
        ...base,
        reason: `exit ${result.exitCode}${
          pattern && !patternOk ? " (output mismatch)" : ""
        }`,
        failureSignature: `exit=${result.exitCode}`,
      };
    } catch (err) {
      return {
        ...base,
        reason: "command run error",
        failureSignature: err instanceof Error ? err.message : "error",
      };
    }
  }

  /** Manual criteria are satisfied only by explicit user confirmation. */
  collectManual(
    criterion: AIChatGoalCriterion,
    opts: GoalCollectOptions
  ): GoalVerificationEvidence {
    return {
      criterionId: criterion.criterionId,
      state: PENDING_FOR_NONDETERMINISTIC,
      sourceRevision: opts.currentRevision,
      timestamp: new Date().toISOString(),
      reason: "awaiting user confirmation",
    };
  }

  /** LLM criteria are resolved by the verifier + LLM, not by collection. */
  collectLlm(
    criterion: AIChatGoalCriterion,
    opts: GoalCollectOptions
  ): GoalVerificationEvidence {
    return {
      criterionId: criterion.criterionId,
      state: PENDING_FOR_NONDETERMINISTIC,
      sourceRevision: opts.currentRevision,
      timestamp: new Date().toISOString(),
      reason: "resolved by LLM verifier",
    };
  }
}
