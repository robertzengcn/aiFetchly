import { isNavigationFailure, type RouteLocationRaw } from "vue-router";

/**
 * A router surface small enough for the workspace shell and for tests.
 * vue-router's `push` rejects with a NavigationFailure instead of throwing
 * a navigation error as a value.
 */
export interface RoutePushTarget {
  push(location: RouteLocationRaw): Promise<unknown>;
}

let tail: Promise<void> = Promise.resolve();

/**
 * Serialize renderer navigations so the latest click wins.
 *
 * vue-router compares a push against the last *committed* route. While a
 * lazy route (Plugins) is still loading, the current route is still the
 * chat, so New chat's push is a duplicate and does not cancel the in-flight
 * Plugins navigation. The user then lands on Plugins (FR-SHELL-010).
 * Queueing every shell push makes the later click run after the earlier
 * one settles, so the latest intent is the route that sticks.
 */
export function enqueueRoutePush(
  router: RoutePushTarget,
  location: RouteLocationRaw
): Promise<void> {
  const run = tail.catch(() => undefined).then(async (): Promise<void> => {
    try {
      await router.push(location);
    } catch (error: unknown) {
      if (!isNavigationFailure(error)) {
        throw error;
      }
    }
  });
  tail = run;
  return run;
}

/** Drop a leftover tail so unit tests do not share queue state. */
export function resetRoutePushQueueForTests(): void {
  tail = Promise.resolve();
}
