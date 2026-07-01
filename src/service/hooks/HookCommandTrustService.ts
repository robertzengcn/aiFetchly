/**
 * In-memory trust store for command hooks.
 *
 * Command hooks are local code execution and must NOT run until they
 * are explicitly trusted. The MVP keeps trust in memory — Phase 4
 * will replace this with a persisted Token-backed store when the UI
 * CRUD lands. Until then, `setTrusted(hookId, true)` is the gate.
 *
 * Note: `HookDefinition.trusted` is the static flag set by whoever
 * registered the hook. This service is the dynamic, user-approved
 * layer on top: a hook only runs when both are true.
 */

class HookCommandTrustServiceImpl {
  private trusted = new Set<string>();

  isTrusted(hookId: string): boolean {
    return this.trusted.has(hookId);
  }

  setTrusted(hookId: string, trusted: boolean): void {
    if (!hookId) throw new Error("hookId is required");
    if (trusted) {
      this.trusted.add(hookId);
    } else {
      this.trusted.delete(hookId);
    }
  }

  /** Test-only: wipe all trust grants. */
  resetForTests(): void {
    this.trusted.clear();
  }
}

export const HookCommandTrustService = new HookCommandTrustServiceImpl();
