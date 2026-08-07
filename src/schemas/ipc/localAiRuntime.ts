/**
 * Local AI Runtime — renderer IPC input schemas.
 *
 * Runtime status/install/remove are local component-management operations,
 * not hosted AI requests, so handlers use registerValidatedHandler (design
 * §20.3). The operationId and one-time consentToken are issued by the main
 * process in prepareInstall and bind the later install request to the exact
 * runtime/version/offer shown to the user (design §14.2).
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import {
  runtimeIdSchema,
  semverSchema,
} from "@/schemas/localAiRuntime";

const uuidSchema = z.string().uuid();

export const runtimeStatusInputSchema = lazySchema(() =>
  z.strictObject({ runtimeId: runtimeIdSchema }),
);

export const runtimePrepareInstallInputSchema = lazySchema(() =>
  z.strictObject({ runtimeId: runtimeIdSchema }),
);

export const runtimeInstallInputSchema = lazySchema(() =>
  z.strictObject({
    operationId: uuidSchema,
    runtimeId: runtimeIdSchema,
    expectedRuntimeVersion: semverSchema,
    consentToken: uuidSchema,
  }),
);

export const runtimeCancelInputSchema = lazySchema(() =>
  z.strictObject({ operationId: uuidSchema }),
);

export const runtimeCheckUpdateInputSchema = lazySchema(() =>
  z.strictObject({ runtimeId: runtimeIdSchema }),
);

export const runtimeRemoveInputSchema = lazySchema(() =>
  z.strictObject({
    runtimeId: runtimeIdSchema,
    removeModels: z.boolean().default(false),
  }),
);
