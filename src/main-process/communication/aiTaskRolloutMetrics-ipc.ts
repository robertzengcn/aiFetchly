import { ipcMain } from "electron";
import { ensureHostedAiEnabled } from "@/service/AiFeatureGate";
import { AI_TASK_ROLLOUT_METRICS_GET } from "@/config/channellist";
import { rolloutMetricsQuerySchema } from "@/entityTypes/aiTaskRolloutMetricsTypes";
import { AiTaskRolloutMetricsModule } from "@/modules/AiTaskRolloutMetricsModule";
import type { RolloutMetricsSnapshot } from "@/entityTypes/aiTaskRolloutMetricsTypes";
import type { CommonMessage } from "@/entityTypes/commonType";

function ok(data: RolloutMetricsSnapshot): CommonMessage<RolloutMetricsSnapshot> {
  return { status: true, msg: "", data };
}
function denied(msg: string): CommonMessage<RolloutMetricsSnapshot> {
  return { status: false, msg, data: undefined };
}

/**
 * Decode a preload payload with a Zod schema. Electron serializes objects
 * before invoking IPC handlers, while tests/dev bridges may pass objects.
 * (Same shape as the scheduled-loop handlers' `decode` — kept local because
 * this schema is `zod/v4`, which does not satisfy the shared
 * `registerAiValidatedHandler` wrapper's `zod` v3 `ZodType` parameter.)
 */
function decode(
  data: unknown
): { ok: true; value: { since: string } } | { ok: false; message: string } {
  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return { ok: false, message: "Invalid request payload" };
    }
  }
  const result = rolloutMetricsQuerySchema.safeParse(payload);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, message: "Invalid request payload" };
}

async function handleGet(
  data: unknown
): Promise<CommonMessage<RolloutMetricsSnapshot>> {
  if (!(await ensureHostedAiEnabled())) {
    return denied("AI functionality is only available to subscribers.");
  }
  const decoded = decode(data);
  if (!decoded.ok) return denied(decoded.message);
  const module = new AiTaskRolloutMetricsModule();
  try {
    // The module itself fail-closes to an all-zero snapshot on any
    // aggregation error (missing tables, corrupt rows) — the catch below is
    // defense in depth so a module-construction failure still resolves to a
    // status:false envelope instead of an ipcMain.handle rejection.
    const snapshot = await module.getRolloutSnapshot(decoded.value);
    return ok(snapshot);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Rollout metrics read failed.";
    return denied(message);
  }
}

/**
 * Register the §17 rollout-metrics read channel.
 *
 * The handler checks USER_AI_ENABLED (via ensureHostedAiEnabled, FR-6 lazy
 * reconciliation) BEFORE parsing the payload or constructing the module —
 * the snapshot only has meaning for flag-enrolled runs, which require an
 * enabled subscription. No direct database access here: the handler
 * delegates entirely to AiTaskRolloutMetricsModule.
 */
export function registerAiTaskRolloutMetricsIpcHandlers(): void {
  ipcMain.handle(AI_TASK_ROLLOUT_METRICS_GET, async (_e, data: unknown) =>
    handleGet(data)
  );
}
