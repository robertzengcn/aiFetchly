"use strict";
/**
 * Local AI Runtime — disposable probe worker entry.
 *
 * Runs in an Electron `utilityProcess` spawned by `DisposableVoiceRuntimeProbe`
 * during runtime install/repair. Receives one `probe` message, loads the staged
 * runtime's native addon via a scoped `createRequire`, verifies each required
 * export is a function, posts a `result`, and EXITS immediately so the OS
 * releases the native-module file lock (required on Windows for the parent's
 * staging -> version rename).
 *
 * The dispatch core is exported as `dispatchProbeMessage` (DI'd sink) so it is
 * unit-testable without forking. Hard rules (CLAUDE.md): no DB / TypeORM /
 * Model / Module imports; validate every inbound message.
 */
import { createRequire } from "node:module";
import path from "node:path";
import {
  runtimeProbeRequestSchema,
  type RuntimeProbeResult,
} from "@/schemas/worker/runtimeProbe";

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

/** Result row reported for each requested export. */
export interface RuntimeProbeExportOutcome {
  name: string;
  present: boolean;
}

/** Sink the dispatcher uses to post results + exit. Abstracted for testing. */
export interface ProbeSink {
  post(message: RuntimeProbeResult): void;
  exit(code: number): void;
}

function buildResult(
  requestId: string,
  ok: boolean,
  exports: readonly RuntimeProbeExportOutcome[],
  errorMessage?: string
): RuntimeProbeResult {
  return {
    type: "result",
    requestId,
    ok,
    exports: exports.map((e) => ({ name: e.name, present: e.present })),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

/**
 * Load `entryModule` from the staged runtime root and verify every name in
 * `requiredExports` is a function. Pure + sink-injected for unit tests.
 */
export async function dispatchProbeMessage(
  raw: unknown,
  sink: ProbeSink
): Promise<void> {
  const parsed = runtimeProbeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    sink.post(
      buildResult(
        "unknown",
        false,
        [],
        `Invalid probe request: ${parsed.error.message}`
      )
    );
    return;
  }
  const { requestId, runtimeRoot, entryModule, requiredExports } = parsed.data;

  try {
    const runtimeRequire = createRequire(
      path.join(runtimeRoot, "package.json")
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (runtimeRequire(entryModule) as Record<string, unknown>) ?? {};
    const outcomes: RuntimeProbeExportOutcome[] = requiredExports.map(
      (name) => ({
        name,
        present: typeof mod[name] === "function",
      })
    );
    const ok = outcomes.every((o) => o.present);
    const missing = outcomes
      .filter((o) => !o.present)
      .map((o) => o.name)
      .join(", ");
    sink.post(
      buildResult(
        requestId,
        ok,
        outcomes,
        ok ? undefined : `Missing required exports: ${missing}`
      )
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    sink.post(
      buildResult(
        requestId,
        false,
        [],
        `Native load failed: ${errorMessage}`
      )
    );
  }
}

// --- Process wiring (only active when forked as a utilityProcess) -----------

const parentPort = (
  process as unknown as { parentPort?: WorkerParentPort }
).parentPort;

if (parentPort) {
  const sink: ProbeSink = {
    post: (message) => {
      try {
        parentPort.postMessage(JSON.stringify(message));
      } catch (postError) {
        const msg =
          postError instanceof Error ? postError.message : String(postError);
        console.error(`[RuntimeProbeWorker] Failed to post message: ${msg}`);
      }
    },
    exit: (code) => process.exit(code),
  };

  parentPort.on("message", async (event: ParentPortMessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch (parseError) {
      const msg =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.error(`[RuntimeProbeWorker] Non-JSON inbound: ${msg}`);
      sink.post(
        buildResult("unknown", false, [], "Inbound message is not valid JSON.")
      );
      sink.exit(1);
      return;
    }
    await dispatchProbeMessage(parsed, sink);
    // One-shot probe complete: exit now so the parent can observe exit (and
    // release the native-module lock on Windows) before renaming staging.
    sink.exit(0);
  });

  process.on("uncaughtException", (error: unknown) => {
    console.error("[RuntimeProbeWorker] Uncaught exception:", error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    console.error("[RuntimeProbeWorker] Unhandled rejection:", reason);
    process.exit(1);
  });
}
