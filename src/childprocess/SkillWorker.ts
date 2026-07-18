import { SandboxedSkillExecutor } from "@/service/SandboxedSkillExecutor";
import { log } from "@/modules/Logger";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { HookInput, HookOutput } from "@/entityTypes/hookTypes";
import {
  skillWorkerInboundSchema,
  type SkillWorkerInbound,
} from "@/schemas/worker/skillWorker";
import { parseWorkerMessage } from "@/schemas/worker/_shared";

interface ExecuteSkillMessage {
  type: "EXECUTE_SKILL";
  requestId: string;
  code: string;
  args: Record<string, unknown>;
  context: SkillExecutionContext;
}

interface ExecuteHookMessage {
  type: "EXECUTE_HOOK";
  requestId: string;
  script: string;
  input: HookInput;
}

type WorkerRequestMessage = ExecuteSkillMessage | ExecuteHookMessage;

interface SkillResultMessage {
  type: "SKILL_RESULT";
  requestId: string;
  result: Awaited<ReturnType<typeof SandboxedSkillExecutor.execute>>;
}

interface HookResultMessage {
  type: "HOOK_RESULT";
  requestId: string;
  result: HookOutput;
}

interface SkillErrorMessage {
  type: "SKILL_ERROR";
  requestId: string;
  error: string;
}

interface ParentPortMessageEvent {
  data: string;
}

interface WorkerParentPort {
  on: (
    event: "message",
    handler: (event: ParentPortMessageEvent) => void | Promise<void>
  ) => void;
  postMessage: (message: string) => void;
}

const parentPort = (process as unknown as { parentPort?: WorkerParentPort })
  .parentPort;

const activeRequestIds = new Set<string>();

function postMessageSafe(
  message: SkillResultMessage | HookResultMessage | SkillErrorMessage
): void {
  if (!parentPort) {
    return;
  }
  try {
    parentPort.postMessage(JSON.stringify(message));
  } catch (postError) {
    const errorMessage =
      postError instanceof Error ? postError.message : String(postError);
    log.error(`[SkillWorker] Failed to post message: ${errorMessage}`);
  }
}

function sendFatalErrorToActiveRequests(error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  for (const requestId of activeRequestIds) {
    postMessageSafe({
      type: "SKILL_ERROR",
      requestId,
      error: errorMessage,
    });
  }
}

function validateExecuteHookMessage(parsed: unknown): ExecuteHookMessage {
  const message = parsed as Partial<ExecuteHookMessage>;
  if (
    message.type !== "EXECUTE_HOOK" ||
    typeof message.requestId !== "string" ||
    typeof message.script !== "string" ||
    typeof message.input !== "object" ||
    message.input === null
  ) {
    throw new Error("Invalid EXECUTE_HOOK message payload");
  }
  return message as ExecuteHookMessage;
}

/**
 * Execute a plugin hook script in-process (worker side). The script is a
 * JS function body that receives `input` (HookInput) and returns a
 * HookOutput. Wrapped in a try/catch — any error becomes SKILL_ERROR.
 *
 * Runs synchronously with `new Function` — no async, no I/O, no require.
 * The worker process itself is the sandbox boundary; plugins cannot
 * escape to main-process APIs from here.
 */
function executeHookScript(script: string, input: HookInput): HookOutput {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function("input", script) as (input: HookInput) => HookOutput;
  const result = fn(input);
  if (!result || typeof result !== "object") {
    return { continue: true, permissionDecision: "allow" };
  }
  return result;
}

if (parentPort) {
  parentPort.on("message", async (event: ParentPortMessageEvent) => {
    let requestId = "unknown";
    try {
      const parsed = JSON.parse(event.data) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { requestId?: unknown }).requestId === "string"
      ) {
        requestId = (parsed as { requestId: string }).requestId;
      }
      // WS-4 R4.6: validate the inbound message via Zod safeParse (replaces the
      // hand-written validateExecuteSkillMessage type-guard). Malformed → drop
      // with a SKILL_ERROR reply, never crash.
      const validation = parseWorkerMessage<SkillWorkerInbound>(
        parsed,
        skillWorkerInboundSchema()
      );
      if (!validation.success) {
        log.warn(
          "[SkillWorker] dropped malformed EXECUTE_SKILL:",
          validation.error
        );
        postMessageSafe({
          type: "SKILL_ERROR",
          requestId,
          error: "Invalid EXECUTE_SKILL message payload",
        });
        return;
      }
      const message = validation.data;
      requestId = message.requestId;
      activeRequestIds.add(requestId);

      const result = await SandboxedSkillExecutor.execute(
        message.code,
        message.args,
        message.context as unknown as SkillExecutionContext
      );

      postMessageSafe({
        type: "SKILL_RESULT",
        requestId,
        result,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      postMessageSafe({
        type: "SKILL_ERROR",
        requestId,
        error: errorMessage,
      });
    } finally {
      activeRequestIds.delete(requestId);
    }
  });
}

process.on("uncaughtException", (error: unknown) => {
  log.error("[SkillWorker] Uncaught exception:", error);
  sendFatalErrorToActiveRequests(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("[SkillWorker] Unhandled rejection:", reason);
  sendFatalErrorToActiveRequests(reason);
  process.exit(1);
});
