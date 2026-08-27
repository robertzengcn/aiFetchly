/**
 * SubscriptionEntitlementService — main-process singleton that owns WHEN to
 * reconcile entitlement from `GET /api/user/info`.
 *
 * Design (see docs/prd/subscription-entitlement-reconciliation-technical-design.md §6):
 *
 * - One writer: `UserController.updateUserInfo()` persists `USERPLANS` /
 *   `USER_AI_ENABLED`. This service calls it, compares a before/after snapshot,
 *   and broadcasts `USER_INFO_UPDATED` to the renderer only when the snapshot
 *   changed (PRD FR-1.1, FR-7).
 * - Pull is correctness, push is speed: WebSocket notifies trigger a reconcile
 *   but never write plan fields from the notify payload (PRD §7).
 * - Cheap: event-driven with in-flight dedupe + cooldowns, not a tight poll.
 *
 * This service MUST NOT import `WebSocketClient` or `TokenRefreshService` —
 * those callers import the service, never the reverse, to avoid circular
 * dependencies (technical design §15).
 */

import { BrowserWindow } from "electron";
import { log } from "@/modules/Logger";
import { UserController } from "@/controller/UserController";
import { resolveViteLoginBase } from "@/config/viteLoginUrl";
import { USER_INFO_UPDATED } from "@/config/channellist";
import { USERPLANS, USER_AI_ENABLED, TOKENNAME } from "@/config/usersetting";
import { Token } from "@/modules/token";
import { userInfoUpdatedEventSchema } from "@/schemas/ipc/subscriptionEntitlement";
import type { UserPlanType } from "@/entityTypes/userType";
import type {
  EntitlementReconcileResult,
  EntitlementSnapshot,
  EntitlementTrigger,
  ReconcileOptions,
  UserInfoUpdatedEvent,
} from "@/entityTypes/subscriptionEntitlementTypes";

/**
 * Reconciliation timing constants. Read from constants in v1; tests inject a
 * clock / config via constructor options (technical design §6.1).
 */
export const ENTITLEMENT_CONFIG = {
  /** How long after opening pricing that window focus triggers an aggressive reconcile. */
  PRICING_WINDOW_MS: 15 * 60 * 1000,
  /** Retry offsets after opening pricing, to ride through Kill Bill sync lag. */
  PRICING_RETRY_OFFSETS_MS: [0, 3000, 6000, 10000, 20000],
  /** Cooldown for `focus`-triggered reconciles (PRD FR-4.1). */
  FOCUS_COOLDOWN_MS: 60 * 1000,
  /** Cooldown for `gated_feature`-triggered reconciles (PRD FR-6.4). */
  GATED_COOLDOWN_MS: 30 * 1000,
  /** Skip ws_connect reconcile if a startup reconcile succeeded recently. */
  STARTUP_CONNECT_COALESCE_MS: 10 * 1000,
} as const;

/** Options for tests to inject a clock / config. Production uses defaults. */
export interface EntitlementServiceOptions {
  /** Inject now() for tests. Default: Date.now. */
  now?: () => number;
  /** Inject setTimeout for tests (so timers can be faked/flushed). */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Inject clearTimeout for tests. */
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  /**
   * Inject the access-token presence check for tests (default reads Token).
   * Returning false skips the reconcile (no-token auth skip, design §6.3).
   */
  hasAccessToken?: () => boolean;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Snapshot equality key. Normalizes plans to `{ planName, planId, status }`
 * sorted by `planName`, joined with `aiEnabled`. Ignores `startDate` / `price`
 * jitter so a no-op GET does not toast (technical design §5.2).
 */
function snapshotHash(snapshot: EntitlementSnapshot): string {
  const normalized = snapshot.plans
    .map((p) => ({
      planName: (p.planName || "").toLowerCase(),
      planId: (p.planId || "").toUpperCase(),
      status: (p.status || "").toLowerCase(),
    }))
    .sort((a, b) => a.planName.localeCompare(b.planName));
  return JSON.stringify({ plans: normalized, ai: snapshot.aiEnabled });
}

export class SubscriptionEntitlementService {
  private static _instance: SubscriptionEntitlementService | null = null;

  static getInstance(
    opts?: EntitlementServiceOptions
  ): SubscriptionEntitlementService {
    if (!SubscriptionEntitlementService._instance) {
      SubscriptionEntitlementService._instance =
        new SubscriptionEntitlementService(opts);
    }
    return SubscriptionEntitlementService._instance;
  }

  /** Reset the singleton. Tests only — never call in production. */
  static resetInstance(): void {
    if (SubscriptionEntitlementService._instance) {
      SubscriptionEntitlementService._instance.clearPricingRetries();
    }
    SubscriptionEntitlementService._instance = null;
  }

  // --- in-memory state (no disk persistence; PRD non-goal §8 / design §6.2) ---
  private inFlight: Promise<EntitlementReconcileResult> | null = null;
  private pricingOpenedAt: number | null = null;
  private pricingRetryTimers: Timer[] = [];
  private lastFocusReconcileAt = 0;
  private lastGatedReconcileAt = 0;
  private lastSuccessAt = 0;
  private lastSuccessHash = "";
  private mainWindow: BrowserWindow | null = null;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (id: Timer) => void;
  private readonly hasAccessToken: () => boolean;

  private constructor(opts?: EntitlementServiceOptions) {
    this.now = opts?.now ?? Date.now;
    this.setTimer = opts?.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts?.clearTimer ?? ((id) => clearTimeout(id));
    this.hasAccessToken =
      opts?.hasAccessToken ??
      (() => {
        try {
          return (new Token().getValue(TOKENNAME) || "").length > 0;
        } catch {
          return false;
        }
      });
  }

  /** Set by userIpc once the main BrowserWindow exists. */
  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  // ----------------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------------

  /**
   * Reconcile entitlement from `GET /api/user/info`.
   *
   * Deduplicates concurrent triggers onto one GET (FR-1.2), applies
   * cooldowns for `focus` / `gated_feature` (FR-4.1, FR-6.4), coalesces
   * `ws_connect` with a recent startup success, and broadcasts to the
   * renderer only when the snapshot changed (FR-7).
   */
  reconcile(
    trigger: EntitlementTrigger,
    opts: ReconcileOptions = {}
  ): Promise<EntitlementReconcileResult> {
    // 1. Dedupe: a reconcile already in flight? Coalesce onto it.
    if (this.inFlight) {
      log.debug(`[entitlement] coalesce trigger=${trigger} into in-flight`);
      return this.inFlight.then((res) => ({
        ...res,
        trigger,
        skipped: true,
        failReason: "in_flight_shared" as const,
      }));
    }

    const force = opts.force === true;

    // 2. Cooldowns for focus / gated (unless force).
    if (trigger === "focus" && !force) {
      const prev = this.readSnapshot();
      if (prev.aiEnabled) {
        // FR-4.2: paid users skip the focus pull entirely.
        return Promise.resolve(this.skipped(trigger, prev, "cooldown"));
      }
      if (
        this.now() - this.lastFocusReconcileAt <
        ENTITLEMENT_CONFIG.FOCUS_COOLDOWN_MS
      ) {
        return Promise.resolve(this.skipped(trigger, prev, "cooldown"));
      }
    }

    if (trigger === "gated_feature" && !force) {
      if (
        this.now() - this.lastGatedReconcileAt <
        ENTITLEMENT_CONFIG.GATED_COOLDOWN_MS
      ) {
        return Promise.resolve(
          this.skipped(trigger, this.readSnapshot(), "cooldown")
        );
      }
    }

    // 3. Coalesce ws_connect with a recent startup success.
    if (trigger === "ws_connect") {
      if (
        this.lastSuccessAt > 0 &&
        this.now() - this.lastSuccessAt <
          ENTITLEMENT_CONFIG.STARTUP_CONNECT_COALESCE_MS
      ) {
        return Promise.resolve(
          this.skipped(trigger, this.readSnapshot(), "cooldown")
        );
      }
    }

    // 4. Run the reconcile, releasing the in-flight slot when done.
    this.inFlight = this.doReconcile(trigger, opts).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Record that the user opened the pricing page, open the URL in the system
   * browser, and (if the user is not already on a paid plan) start a short
   * retry loop to ride through Kill Bill sync lag (PRD FR-3).
   */
  async markPricingOpened(): Promise<{ url: string }> {
    const resolved = resolveViteLoginBase();
    const raw = resolved?.value;
    if (!raw || raw === "undefined" || raw === "null") {
      throw new Error(
        "VITE_LOGIN_URL is not set; cannot open pricing plan page."
      );
    }
    const url = `${raw.replace(/\/+$/, "")}/pricing-plan`;

    this.pricingOpenedAt = this.now();
    this.clearPricingRetries();

    // FR-3.4: if already on a paid AI plan, skip the aggressive retry loop.
    if (!this.readSnapshot().aiEnabled) {
      for (const offset of ENTITLEMENT_CONFIG.PRICING_RETRY_OFFSETS_MS) {
        const timer = this.setTimer(() => {
          void this.reconcile("pricing", { force: true }).then((res) => {
            if (res.ok && res.snapshot.aiEnabled) {
              // FR-3.3: stop early once an active paid plan is observed.
              this.clearPricingRetries();
            }
          });
        }, offset);
        this.pricingRetryTimers.push(timer);
      }
    }

    return { url };
  }

  /** Clear all pending pricing retry timers. */
  clearPricingRetries(): void {
    for (const t of this.pricingRetryTimers) {
      this.clearTimer(t);
    }
    this.pricingRetryTimers = [];
  }

  /**
   * Window focus hook (PRD FR-3.2 / FR-4).
   *
   * If within the pricing window, force a reconcile. Otherwise run a
   * cooldown-gated `focus` reconcile only when the local cache is all-free.
   */
  onMainWindowFocus(): void {
    if (
      this.pricingOpenedAt &&
      this.now() - this.pricingOpenedAt <= ENTITLEMENT_CONFIG.PRICING_WINDOW_MS
    ) {
      void this.reconcile("pricing", { force: true });
    } else {
      void this.reconcile("focus");
    }
  }

  // ----------------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------------

  private async doReconcile(
    trigger: EntitlementTrigger,
    opts: ReconcileOptions
  ): Promise<EntitlementReconcileResult> {
    const previous = this.readSnapshot();
    log.info(`[entitlement] reconcile start trigger=${trigger}`);

    const userController = new UserController();

    // --- No access token → skip reconcile entirely (design §6.3 / §9).
    //     Keeps the cache; no GET is issued. A signed-out user has no
    //     entitlement to reconcile. ---
    if (!this.hasAccessToken()) {
      log.info(
        `[entitlement] reconcile skip trigger=${trigger} reason=no_token (cache kept)`
      );
      this.touchCooldowns(trigger);
      return {
        ok: false,
        changed: false,
        skipped: true,
        trigger,
        snapshot: previous,
        previous,
        failReason: "auth",
      };
    }

    // --- Pricing-window guard: if inside the pricing window and the GET
    //     would write Community/empty, treat it as a transient failure and
    //     keep the previous cache (design §9). ---
    const inPricingWindow =
      this.pricingOpenedAt !== null &&
      this.now() - (this.pricingOpenedAt as number) <=
        ENTITLEMENT_CONFIG.PRICING_WINDOW_MS;

    try {
      // updateUserInfo() throws on network/GET failure (cache untouched).
      // On success with empty plans it writes Community (design §9 / FR-1.4).
      await userController.updateUserInfo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Classify 401/auth-shape failures as "auth" (HttpClient already tried
      // a refresh; this means the session is rejected). Do NOT sign out —
      // matches the token-refresh policy of keeping the local session (§9).
      const isAuth =
        /\b401\b|403|Authentication failed|Please login again|RefreshTokenInvalidError|invalid or expired|refresh token rejected|Forbidden/i.test(
          msg
        );
      const reason = isAuth ? "auth" : "network";
      log.warn(
        `[entitlement] reconcile fail trigger=${trigger} reason=${reason} (cache kept) plans=${
          previous.planNames.join(",") || "(none)"
        } aiEnabled=${previous.aiEnabled}: ${msg}`
      );
      this.touchCooldowns(trigger);
      return {
        ok: false,
        changed: false,
        skipped: false,
        trigger,
        snapshot: previous,
        previous,
        failReason: reason,
      };
    }

    // Pricing-window guard: read the just-persisted snapshot; if it is empty
    // / all-Community inside the pricing window, restore previous cache.
    let next = this.readSnapshot();
    if (
      inPricingWindow &&
      !next.aiEnabled &&
      this.snapshotIsCommunityOrEmpty(next)
    ) {
      // Restore previous cache so a lagging Kill Bill does not overwrite a
      // paid plan with Community during checkout.
      try {
        const tokenService = new Token();
        if (previous.plans.length > 0) {
          tokenService.setValue(
            USERPLANS,
            JSON.stringify(previous.plans as UserPlanType[])
          );
        }
        tokenService.setValue(
          USER_AI_ENABLED,
          previous.aiEnabled ? "true" : "false"
        );
        log.info(
          `[entitlement] pricing-window guard restored previous cache (trigger=${trigger})`
        );
        next = previous;
      } catch (restoreErr) {
        log.error(
          "[entitlement] failed to restore cache during pricing-window guard",
          restoreErr
        );
      }
    }

    const changed = snapshotHash(previous) !== snapshotHash(next);
    this.lastSuccessAt = this.now();
    this.lastSuccessHash = snapshotHash(next);
    this.touchCooldowns(trigger);

    log.info(
      `[entitlement] reconcile ok trigger=${trigger} changed=${changed} aiEnabled=${
        next.aiEnabled
      } previousPlans=${previous.planNames.join(",") || "(none)"} plans=${
        next.planNames.join(",") || "(none)"
      }`
    );

    if (changed) {
      this.broadcast({
        reason: trigger,
        notificationType: opts.notificationType,
        plans: [...next.plans],
        aiEnabled: next.aiEnabled,
        changed: true,
      });
    }

    return {
      ok: true,
      changed,
      skipped: false,
      trigger,
      snapshot: next,
      previous,
    };
  }

  /** Read the local entitlement cache snapshot (no network). */
  private readSnapshot(): EntitlementSnapshot {
    const userController = new UserController();
    const info = userController.getUserInfo();
    const plans: UserPlanType[] = Array.isArray(info.plans)
      ? (info.plans as UserPlanType[])
      : [];
    const planNames = plans
      .filter((p) => (p.status || "").toLowerCase() === "active")
      .map((p) => p.planName || "");
    return {
      plans,
      aiEnabled: info.aiEnabled === true,
      planNames,
    };
  }

  /** True when the snapshot has no AI plan (Community-only or empty). */
  private snapshotIsCommunityOrEmpty(snapshot: EntitlementSnapshot): boolean {
    if (snapshot.aiEnabled) return false;
    if (snapshot.plans.length === 0) return true;
    return snapshot.plans.every(
      (p) =>
        (p.planName || "").toLowerCase().includes("community") ||
        (p.planName || "").toLowerCase().includes("free")
    );
  }

  /** Update cooldown timestamps for `focus` / `gated_feature`. */
  private touchCooldowns(trigger: EntitlementTrigger): void {
    if (trigger === "focus") {
      this.lastFocusReconcileAt = this.now();
    } else if (trigger === "gated_feature") {
      this.lastGatedReconcileAt = this.now();
    }
  }

  private skipped(
    trigger: EntitlementTrigger,
    snapshot: EntitlementSnapshot,
    reason: "cooldown"
  ): EntitlementReconcileResult {
    log.debug(`[entitlement] skip trigger=${trigger} reason=${reason}`);
    return {
      ok: true,
      changed: false,
      skipped: true,
      trigger,
      snapshot,
      previous: snapshot,
      failReason: reason,
    };
  }

  /** Broadcast the validated event to all live BrowserWindows. */
  private broadcast(event: UserInfoUpdatedEvent): void {
    let parsed: UserInfoUpdatedEvent;
    try {
      parsed = userInfoUpdatedEventSchema().parse(
        event
      ) as UserInfoUpdatedEvent;
    } catch (err) {
      log.error("[entitlement] refused to broadcast invalid event", err);
      return;
    }

    // The project's electron types resolve getAllWindows() to BaseWindow[]
    // (ambiguous declarations); cast to BrowserWindow[] as existing code does
    // (see background.ts) so webContents.send is visible.
    const windows = BrowserWindow.getAllWindows() as BrowserWindow[];
    for (const win of windows) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(USER_INFO_UPDATED, parsed);
        } catch (err) {
          log.error("[entitlement] failed to broadcast to a window", err);
        }
      }
    }
  }
}
