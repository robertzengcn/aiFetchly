import {
  CallbackHookDefinition,
  HookDefinition,
  HookEventName,
  HookSource,
} from "@/entityTypes/hookTypes";
import { matchesHookMatcher } from "./HookMatcher";

/**
 * In-memory registry of hook definitions grouped by event.
 *
 * The MVP supports `builtin` and `session` sources. Other sources
 * (`user`, `project`, `plugin`, `policy`) have explicit priority slots
 * but no persistence/UI wiring yet — they can be registered through
 * `registerBuiltinHook`'s generic sibling once those loaders exist.
 *
 * Ordering: policy > builtin > session > project > plugin > user.
 * Within a source, preserve registration order. Order matters because
 * the aggregator merges `updatedInput` shallowly in execution order.
 */

const SOURCE_PRIORITY: Record<HookSource, number> = {
  policy: 0,
  builtin: 1,
  session: 2,
  project: 3,
  plugin: 4,
  user: 5,
};

export interface HookLookupInput {
  readonly eventName: HookEventName;
  readonly matchQuery?: string;
  readonly sessionId?: string;
}

export interface HookRegistryApi {
  registerBuiltinHook(hook: CallbackHookDefinition): void;
  registerSessionHook(sessionId: string, hook: HookDefinition): void;
  clearSessionHooks(sessionId: string): void;
  /**
   * Atomically reconcile every hook for a config source (HOK-01). Removes all
   * hooks previously registered under {@link sourceId}, then inserts defensive
   * copies of {@link hooks}. Add/change/delete/rename all fall out of the
   * remove-then-insert so stale entries from a prior scan never survive a
   * rescan. SourceId is the full source key ("user", "workspace:<id>").
   */
  replaceSource(sourceId: string, hooks: readonly HookDefinition[]): void;
  /** Remove every hook for a config source (equivalent to replaceSource(id, [])). */
  unregisterSource(sourceId: string): void;
  getMatchingHooks(input: HookLookupInput): readonly HookDefinition[];
  /** Test-only: wipe all hooks including built-ins. */
  resetForTests(): void;
}

interface RegistryEntry {
  readonly hook: HookDefinition;
  /** Undefined for built-ins; set for session-scoped hooks. */
  readonly sessionId?: string;
  /** Insertion counter used to preserve order within a source. */
  readonly seq: number;
}

class HookRegistryImpl implements HookRegistryApi {
  private readonly byEvent = new Map<HookEventName, RegistryEntry[]>();
  /**
   * Per-sourceId bookkeeping for config-sourced hooks (HOK-01). Keys are the
   * full source id string ("user", "workspace:<id>"); values are the hook ids
   * inserted under that source so {@link replaceSource} can remove them again.
   * Built-in/session registrations do not use this index.
   */
  private readonly sourceIndex = new Map<string, Set<string>>();
  private seq = 0;

  registerBuiltinHook(hook: CallbackHookDefinition): void {
    this.assertNoLeak(hook);
    this.push(hook);
  }

  registerSessionHook(sessionId: string, hook: HookDefinition): void {
    if (!sessionId) {
      throw new Error("registerSessionHook requires a sessionId");
    }
    this.assertNoLeak(hook);
    this.push(hook, sessionId);
  }

  clearSessionHooks(sessionId: string): void {
    if (!sessionId) return;
    for (const list of this.byEvent.values()) {
      const filtered = list.filter((e) => e.sessionId !== sessionId);
      // Mutate in place to preserve Map identity.
      list.length = 0;
      list.push(...filtered);
    }
  }

  getMatchingHooks(input: HookLookupInput): readonly HookDefinition[] {
    const list = this.byEvent.get(input.eventName);
    if (!list || list.length === 0) return [];

    const seen = new Set<string>();
    const matched: RegistryEntry[] = [];

    for (const entry of list) {
      if (!entry.hook.enabled) continue;
      if (entry.sessionId && input.sessionId !== entry.sessionId) continue;
      // Untrusted command hooks are excluded — trust gate is enforced
      // at registration time for command hooks, but defense-in-depth.
      if (entry.hook.type === "command" && !entry.hook.trusted) continue;
      if (!matchesHookMatcher(entry.hook.matcher, input.matchQuery ?? ""))
        continue;
      if (seen.has(entry.hook.id)) continue;
      seen.add(entry.hook.id);
      matched.push(entry);
    }

    // Stable sort by (source priority, seq) — preserves registration
    // order within a source.
    matched.sort((a, b) => {
      const pa = SOURCE_PRIORITY[a.hook.source];
      const pb = SOURCE_PRIORITY[b.hook.source];
      if (pa !== pb) return pa - pb;
      return a.seq - b.seq;
    });

    return matched.map((e) => e.hook);
  }

  replaceSource(sourceId: string, hooks: readonly HookDefinition[]): void {
    // 1. Remove every hook previously registered under this sourceId from all
    //    event lists (a hook id lives under exactly one event, but iterate
    //    every list defensively). This is the "delete" half of the atomic
    //    reconcile — stale entries from a prior scan never survive a rescan.
    const existing = this.sourceIndex.get(sourceId);
    if (existing) {
      for (const id of existing) {
        this.removeHookIdFromAllEvents(id);
      }
    }
    // 2. Insert defensive shallow copies of the new hooks so caller mutation
    //    cannot corrupt registry state (CLAUDE.md immutability). The spread
    //    copies all top-level fields including the `type` discriminant and the
    //    type-specific callback/command payload; nested caller mutation is not
    //    a concern for the immutable HookDefinition shape.
    const next = new Set<string>();
    for (const hook of hooks) {
      const copy = { ...hook } as HookDefinition;
      this.push(copy);
      next.add(copy.id);
    }
    this.sourceIndex.set(sourceId, next);
    // No name index to rebuild — hooks key on event+matcher and
    // getMatchingHooks re-sorts by (SOURCE_PRIORITY, seq) on every read.
  }

  unregisterSource(sourceId: string): void {
    this.replaceSource(sourceId, []);
  }

  private removeHookIdFromAllEvents(id: string): void {
    for (const list of this.byEvent.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].hook.id === id) {
          list.splice(i, 1);
        }
      }
    }
  }

  resetForTests(): void {
    this.byEvent.clear();
    this.sourceIndex.clear();
    this.seq = 0;
  }

  private push(hook: HookDefinition, sessionId?: string): void {
    const list = this.byEvent.get(hook.eventName) ?? [];
    if (!this.byEvent.has(hook.eventName)) {
      this.byEvent.set(hook.eventName, list);
    }
    list.push({ hook, sessionId, seq: this.seq++ });
  }

  private assertNoLeak(hook: HookDefinition): void {
    if (!hook.id) {
      throw new Error("Hook must have a non-empty id");
    }
    // Duplicate ids across sources are allowed but within the same
    // event they indicate a registration bug. We warn rather than
    // throw so a stale session reregister doesn't crash the chat.
    const existing = this.byEvent.get(hook.eventName);
    if (existing?.some((e) => e.hook.id === hook.id)) {
      console.warn(
        `Hook id "${hook.id}" is already registered for event "${hook.eventName}". Overlapping ids may cause confusion.`
      );
    }
  }
}

export const HookRegistry: HookRegistryApi = new HookRegistryImpl();
