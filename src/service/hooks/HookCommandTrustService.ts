/**
 * Trust store for command hooks. Persisted to the HookConfig table
 * (via HookModule.setTrusted) and hydrated at app startup from
 * loadUserHooksIntoRegistry.
 *
 * `HookDefinition.trusted` is the static flag set at registration
 * time. This service is the dynamic, user-approved layer on top —
 * a command hook only runs when both are true.
 *
 * Main-process only.
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

  /**
   * Replace the in-memory trusted set. Called by
   * HookModule.loadUserHooksIntoRegistry at startup with the set of
   * hook IDs whose HookConfig.trusted column is true.
   */
  hydrateFromTrustedMap(ids: Set<string>): void {
    this.trusted = new Set(ids);
  }

  /** Current trusted hook IDs. Used by tests and debug views. */
  snapshotTrusted(): Set<string> {
    return new Set(this.trusted);
  }

  /** Test-only: wipe all trust grants. */
  resetForTests(): void {
    this.trusted.clear();
  }
}

export const HookCommandTrustService = new HookCommandTrustServiceImpl();
