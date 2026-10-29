import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Python Runtime Worker inbound message contract (WS-4 R4.6 Zod migration).
 *
 * Replaces the hand-written `validateExecutePythonMessage` type-guard in
 * PythonRuntimeWorker.ts. The worker validates inbound via `parseWorkerMessage`
 * at the parentPort boundary — malformed → dropped with a PYTHON_ERROR reply,
 * never crashed.
 */
export const pythonRuntimeWorkerInboundSchema = lazySchema(() =>
  z.object({
    type: z.literal("EXECUTE_PYTHON"),
    requestId: z.string().min(1, "requestId is required"),
    pythonBin: z.string(),
    scriptPath: z.string(),
    args: z.array(z.string()),
    timeoutMs: z.number(),
  })
);

export type PythonRuntimeWorkerInbound = z.infer<
  ReturnType<typeof pythonRuntimeWorkerInboundSchema>
>;
