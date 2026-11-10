import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { APPLICATION_CLOSE_CHOICES } from "@/entityTypes/applicationLifecycleTypes";

/**
 * Zod schemas for the application-lifecycle IPC boundary
 * (technical design §10).
 *
 * Boundary rules:
 *  - `z.strictObject` rejects unknown keys — the renderer must never be able
 *    to smuggle process IDs, shell commands, or arbitrary quit reasons into
 *    the main process.
 *  - The close-choice token is a bounded opaque string (uuid-shaped);
 *    anything longer is rejected before it reaches the lifecycle service.
 *  - Enum values are imported from the `as const` tuple in the entity-types
 *    module so schema and TS types cannot drift apart.
 */

/** Bounded, printable, single-use dialog token. */
const closeChoiceToken = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "token must be alphanumeric/-/_ only");

/** Renderer ack: "I am showing the dialog for this token". */
export const applicationCloseChoiceAckSchema = lazySchema(() =>
  z.strictObject({
    token: closeChoiceToken,
  })
);
export type ApplicationCloseChoiceAckInput = z.infer<
  ReturnType<typeof applicationCloseChoiceAckSchema>
>;

/** Renderer submission: the user picked `hide` / `exit` / `cancel`. */
export const applicationCloseChoiceSubmissionSchema = lazySchema(() =>
  z.strictObject({
    token: closeChoiceToken,
    choice: z.enum(APPLICATION_CLOSE_CHOICES),
  })
);
export type ApplicationCloseChoiceSubmissionInput = z.infer<
  ReturnType<typeof applicationCloseChoiceSubmissionSchema>
>;

/** Get-state request carries no payload; schema exists for symmetry. */
export const applicationLifecycleGetStateSchema = lazySchema(() =>
  z.strictObject({})
);
