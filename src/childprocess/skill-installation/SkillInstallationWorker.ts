// src/childprocess/skill-installation/SkillInstallationWorker.ts
//
// Utility-process entry for skill-installation staging (design §15.2).
// Receives a validated `stage-package` command, performs the bounded copy +
// tree hash OFF the main process, and emits a `staged`/`error` event.
//
// Worker boundary (CLAUDE.md): imports ONLY node stdlib + the zod protocol
// + the shared stagePackage module. No database / ORM / Electron app /
// safeStorage / renderer / main-process registry code. The worker never
// decides trust, never sees secrets, and never receives database paths —
// main already acquired the source and owns all policy.
//
// Non-fatal by construction: any error (including limit violations)
// surfaces as an `error` response; the worker keeps serving.

import {
  stagePackageRequestSchema,
  stagePackageResponseSchema,
  type StagePackageResponse,
} from "./SkillInstallationWorkerProtocol";
import { stagePackage, StageLimitError } from "./stagePackage";

/** parentPort — the utilityProcess transport. */
const parentPort = (
  process as unknown as {
    parentPort?: {
      on: (
        event: "message",
        cb: (e: { data: unknown }) => void
      ) => void;
      postMessage: (msg: unknown) => void;
    };
  }
).parentPort;

if (!parentPort) {
  // Spawned outside utilityProcess (e.g. child_process.fork in tests):
  // process.send carries the same message shape.
  const forkPort = process as unknown as {
    send?: (msg: unknown) => void;
    on: (event: "message", cb: (msg: unknown) => void) => void;
  };
  if (forkPort.on && forkPort.send) {
    forkPort.on("message", (msg: unknown) => {
      void handleRequest(msg, (response) => forkPort.send?.(response));
    });
  }
} else {
  parentPort.on("message", (event: { data: unknown }) => {
    void handleRequest(event.data, (response) => parentPort.postMessage(response));
  });
}

async function handleRequest(
  raw: unknown,
  reply: (response: StagePackageResponse) => void
): Promise<void> {
  const parsed = stagePackageRequestSchema.safeParse(raw);
  if (!parsed.success) {
    reply({
      type: "error",
      requestId: "",
      code: "REQUEST_INVALID",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const request = parsed.data;
  try {
    const staged = stagePackage(
      request.sourceRoot,
      request.targetRoot,
      request.limits
    );
    const response: StagePackageResponse = {
      type: "staged",
      requestId: request.requestId,
      fileCount: staged.fileCount,
      totalBytes: staged.totalBytes,
      contentHash: staged.contentHash,
    };
    // Self-check before replying: only a schema-valid response leaves the
    // worker (validated again main-side).
    stagePackageResponseSchema.parse(response);
    reply(response);
  } catch (err) {
    reply({
      type: "error",
      requestId: request.requestId,
      code: err instanceof StageLimitError ? "SOURCE_LIMIT_EXCEEDED" : "STAGE_IO_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
