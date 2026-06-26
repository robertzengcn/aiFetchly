// src/service/agentTools/checkShellStatusTool.ts
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";

/**
 * Handler for the check_shell_status tool exposed to the AI.
 *
 * Polls the BackgroundShellRegistry for the current state of a previously
 * backgrounded shell command. Returns the current stdout/stderr buffer
 * snapshot and the terminal status (or "running" if still in flight).
 *
 * This tool is registered alongside shell_execute so the AI can recover
 * results from commands that were auto-backgrounded on timeout.
 */
export async function handleCheckShellStatus(
  args: Record<string, unknown>
): Promise<{
  success: boolean;
  result: Record<string, unknown>;
}> {
  const shellId = String(args.shell_id ?? "").trim();
  if (!shellId) {
    return {
      success: false,
      result: { error: "shell_id is required" },
    };
  }

  const state = getDefaultBackgroundShellRegistry().poll(shellId);
  if (!state) {
    return {
      success: false,
      result: { error: `Shell with id '${shellId}' not found` },
    };
  }

  return {
    success: true,
    result: {
      shell_id: state.shellId,
      status: state.status,
      exit_code: state.exitCode,
      stdout: state.stdout,
      stderr: state.stderr,
      started_at: state.startedAt,
      ended_at: state.endedAt,
    },
  };
}
