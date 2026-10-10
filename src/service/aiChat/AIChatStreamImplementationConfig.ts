// src/service/aiChat/AIChatStreamImplementationConfig.ts
//
// Stage B §16 (generator-streaming PRD FR-018): the internal delivery-mode
// switch. The mode is read ONCE at startup through an injectable provider,
// validated (invalid values fall back to "callback" with a warning), captured
// in run context at acceptance, and never changed for a live or waiting run —
// a mode change affects new runs only. Not a user-facing toggle.

/** Internal environment variable (production provider). */
export const AI_CHAT_STREAM_IMPLEMENTATION_ENV =
  "AI_CHAT_STREAM_IMPLEMENTATION";

export type AIChatStreamImplementationMode = "callback" | "generator";

export interface AIChatStreamImplementationConfigProvider {
  readonly mode: AIChatStreamImplementationMode;
}

/**
 * Production provider: reads the environment variable once at construction.
 * A change takes effect only after a restart, where existing reconciliation
 * handles interrupted runs. Only the chosen mode is logged — never user data.
 */
export class EnvAIChatStreamImplementationConfig
  implements AIChatStreamImplementationConfigProvider
{
  readonly mode: AIChatStreamImplementationMode;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const raw = env[AI_CHAT_STREAM_IMPLEMENTATION_ENV];
    if (raw === "generator" || raw === "callback") {
      this.mode = raw;
    } else {
      if (raw !== undefined) {
        // TODO-14: log the CHOSEN mode only — never echo the arbitrary value
        // (could contain anything a user put in the environment).
        console.warn(
          `[ai-chat-stream] invalid ${AI_CHAT_STREAM_IMPLEMENTATION_ENV} value ignored; using mode=callback`
        );
      }
      this.mode = "callback";
    }
  }
}

/** Test provider with a mutable mode (AC-14: mode pinning across resume). */
export function createMutableStreamImplementationConfig(
  initial: AIChatStreamImplementationMode
): AIChatStreamImplementationConfigProvider & {
  setMode(mode: AIChatStreamImplementationMode): void;
} {
  const state: { mode: AIChatStreamImplementationMode } = { mode: initial };
  return {
    get mode(): AIChatStreamImplementationMode {
      return state.mode;
    },
    setMode(mode: AIChatStreamImplementationMode): void {
      state.mode = mode;
    },
  };
}
