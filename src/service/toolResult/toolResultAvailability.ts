import "reflect-metadata";
import type { ToolResultModule } from "@/modules/ToolResultModule";

/**
 * Bounded existence check for committed outputs in a conversation.
 *
 * Used to decide whether the retrieval tools must stay available when the
 * capture flag is off: a conversation that already saved a large result must
 * remain readable (technical design §13.4).
 *
 * Deliberately a COUNT with a LIMIT 1 rather than a row load, so answering the
 * question can never pull a receipt - or a payload - into memory.
 */
export async function hasCommittedOutputs(
  module: ToolResultModule,
  conversationId: string
): Promise<boolean> {
  try {
    return await module.hasAnyCommittedOutput("default", conversationId);
  } catch {
    return false;
  }
}
