import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * IPC input schemas for the E2E-only seed channels (see
 * src/main-process/e2e/E2ESeedIpc.ts for why these exist and how they are
 * gated). These follow the same conventions as the other IPC schemas —
 * bare `zod` + lazySchema + strictObject — and are never registered outside
 * AIFETCHLY_E2E=1.
 */

// E2E_SEED_EMAIL_SERVICE — insert one email_service row with a plaintext
// password. Host/port shape mirrors EmailServiceEntity (varchar columns).
// The E2E spec points host at a loopback server that drops the connection
// mid-greeting, so the worker fails with an ambiguous SMTP error and the
// delivery deterministically ends in delivery_unknown (FR-019), exercising
// the real worker path without any external network.
export const e2eSeedEmailServiceInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, "Service name is required").max(255),
    from: z.string().min(1, "Sender address is required").max(255),
    password: z.string().min(1, "Password is required").max(255),
    host: z.string().min(1, "SMTP host is required").max(255),
    port: z.string().min(1, "SMTP port is required").max(10),
    ssl: z.number().int().min(0).max(1).optional(),
    status: z.number().int().min(0).max(1).optional(),
  })
);
