import { CallbackHookDefinition } from "@/entityTypes/hookTypes";
import { HookRegistry } from "./HookRegistry";

/**
 * Built-in hooks for safety and compliance.
 *
 * Both are registered with `enabled: true` so they protect the user
 * out of the box. Users can disable individual hooks via the Hooks
 * Management UI or the USER_HOOKS_BUILTIN_OVERRIDES Token.
 *
 * See docs/superpowers/specs/2026-06-23-hooks-system-technical-design.md
 * §Example Built-In Hooks for the policy intent.
 */

const BLOCK_DANGEROUS_SHELL: CallbackHookDefinition = {
  id: "builtin-block-dangerous-shell-delete",
  eventName: "PreToolUse",
  matcher: "shell_execute",
  source: "builtin",
  enabled: true,
  trusted: true,
  failureMode: "block",
  statusMessage: "Checking shell command policy",
  type: "callback",
  callback: (input) => {
    if (input.eventName !== "PreToolUse") return {};
    const command = String(
      (input as { input?: { command?: unknown } }).input?.command ?? ""
    );
    if (/\brm\s+-rf\s+(\/|\*)/.test(command)) {
      return {
        continue: false,
        reason:
          "Dangerous recursive delete command blocked by hook policy.",
      };
    }
    return { continue: true };
  },
};

const SCRAPING_COMPLIANCE: CallbackHookDefinition = {
  id: "builtin-scraping-compliance-context",
  eventName: "PostToolUse",
  matcher: "scrape_*",
  source: "builtin",
  enabled: true,
  trusted: true,
  type: "callback",
  callback: () => ({
    additionalContext:
      "When using scraped contact data, recommend compliant outreach and avoid storing unnecessary personal data.",
  }),
};

const ALL_BUILTIN_HOOKS: readonly CallbackHookDefinition[] = [
  BLOCK_DANGEROUS_SHELL,
  SCRAPING_COMPLIANCE,
];

let registered = false;

/**
 * Register built-in demo hooks. Safe to call multiple times —
 * subsequent calls are no-ops (HookRegistry dedupes by id and warns).
 */
export function registerBuiltinHooks(): void {
  if (registered) return;
  for (const hook of ALL_BUILTIN_HOOKS) {
    HookRegistry.registerBuiltinHook(hook);
  }
  registered = true;
}

/** Test-only: force re-registration on next call. */
export function resetBuiltinHooksRegistrationForTests(): void {
  registered = false;
}
