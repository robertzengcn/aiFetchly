import { SandboxedSkillExecutor } from "@/service/SandboxedSkillExecutor";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

interface ExecuteSkillMessage {
  type: "EXECUTE_SKILL";
  requestId: string;
  code: string;
  args: Record<string, unknown>;
  context: SkillExecutionContext;
}

interface SkillResultMessage {
  type: "SKILL_RESULT";
  requestId: string;
  result: Awaited<ReturnType<typeof SandboxedSkillExecutor.execute>>;
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
  message: SkillResultMessage | SkillErrorMessage
): void {
  if (!parentPort) {
    return;
  }
  try {
    parentPort.postMessage(JSON.stringify(message));
  } catch (postError) {
    const errorMessage =
      postError instanceof Error ? postError.message : String(postError);
    console.error(`[SkillWorker] Failed to post message: ${errorMessage}`);
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

function validateExecuteSkillMessage(parsed: unknown): ExecuteSkillMessage {
  const message = parsed as Partial<ExecuteSkillMessage>;
  if (
    message.type !== "EXECUTE_SKILL" ||
    typeof message.requestId !== "string" ||
    typeof message.code !== "string" ||
    typeof message.args !== "object" ||
    message.args === null ||
    typeof message.context !== "object" ||
    message.context === null
  ) {
    throw new Error("Invalid EXECUTE_SKILL message payload");
  }
  return message as ExecuteSkillMessage;
}

if (parentPort) {
  parentPort.on("message", async (event: ParentPortMessageEvent) => {
    let requestId = "unknown";
    try {
      const parsed = JSON.parse(event.data) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "requestId" in parsed &&
        typeof (parsed as { requestId?: unknown }).requestId === "string"
      ) {
        requestId = (parsed as { requestId: string }).requestId;
      }
      const message = validateExecuteSkillMessage(parsed);
      requestId = message.requestId;
      activeRequestIds.add(requestId);

      const result = await SandboxedSkillExecutor.execute(
        message.code,
        message.args,
        message.context
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
  console.error("[SkillWorker] Uncaught exception:", error);
  sendFatalErrorToActiveRequests(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[SkillWorker] Unhandled rejection:", reason);
  sendFatalErrorToActiveRequests(reason);
  process.exit(1);
});
