import { log } from "@/modules/Logger";
import type { ApplicationCloseChoice } from "@/entityTypes/applicationLifecycleTypes";
import type { ApplicationLifecycleService as LifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";

/**
 * CloseChoiceFlow — orchestrates the FR-01 close-choice dialog with the
 * native fallback (technical design §9).
 *
 * Sequence for an ordinary window close:
 *  1. Ask the lifecycle service for a dialog token (it refuses while
 *     quitting or when a dialog is already pending — AC-01/AC-08).
 *  2. Send the request to the renderer and start a bounded ack timer.
 *  3. If the renderer does not acknowledge within `ackTimeoutMs`, show a
 *     localized NATIVE dialog — but only if the renderer surface never
 *     became active, so at most one surface is ever showing.
 *  4. Any late renderer response after fallback/native choice is rejected
 *     by the service as a stale token.
 *
 * Explicit Quit (tray, menu, update) never enters this flow (FR-03/FR-04).
 * Electron surface (windows, dialogs, IPC) is injected via ports.
 */

export interface CloseChoiceFlowPorts {
  /**
   * Fire the renderer request (token, background availability, and the
   * trustworthy active-task count when one was provided — FR-01).
   */
  readonly sendRendererRequest: (
    token: string,
    backgroundAvailable: boolean,
    activeTaskCount?: number
  ) => void;
  /** Localized native fallback (returns the user's choice). */
  readonly showNativeFallback: (
    backgroundAvailable: boolean
  ) => Promise<ApplicationCloseChoice>;
  /** Execute an accepted hide (window hide is background.ts's job). */
  readonly hideWindow: () => void;
  readonly ackTimeoutMs?: number;
  /** Clock/timer injection for tests. */
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

export class CloseChoiceFlow {
  private readonly lifecycle: LifecycleService;
  private readonly ports: CloseChoiceFlowPorts;
  private readonly ackTimeoutMs: number;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(lifecycle: LifecycleService, ports: CloseChoiceFlowPorts) {
    this.lifecycle = lifecycle;
    this.ports = ports;
    this.ackTimeoutMs = ports.ackTimeoutMs ?? 2_000;
  }

  /** True while a close-choice dialog (renderer or native) is showing. */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Begin the flow for an ordinary close. No-op while quitting or when a
   * dialog is already active (AC-08: repeated × must not stack dialogs).
   */
  begin(activeTaskCount?: number): void {
    if (this.active || this.lifecycle.isQuitting()) return;
    const issued = this.lifecycle.beginCloseChoice(activeTaskCount);
    if (issued.result !== "issued") {
      // 'dialog-open' cannot happen (guarded by this.active); 'quitting' /
      // 'not-visible' mean nothing to ask.
      return;
    }
    this.active = true;
    const token = issued.token;
    this.ports.sendRendererRequest(
      token,
      this.lifecycle.isBackgroundAvailable(),
      typeof issued.activeTaskCount === "number"
        ? issued.activeTaskCount
        : undefined
    );

    const { setTimeoutFn = setTimeout } = this.ports;
    this.ackTimer = setTimeoutFn(() => {
      this.ackTimer = null;
      // Fallback only if the renderer never showed its surface (§9).
      if (!this.lifecycle.isCloseChoiceTokenLive(token)) return;
      if (this.lifecycle.hasRendererAcknowledged()) return;
      void this.runNativeFallback(token);
    }, this.ackTimeoutMs);
    if (typeof (this.ackTimer as { unref?: () => void }).unref === "function") {
      (this.ackTimer as { unref: () => void }).unref();
    }
  }

  /** Renderer acknowledged its dialog is visible — cancel the fallback. */
  acknowledge(token: string): boolean {
    return this.lifecycle.acknowledgeCloseChoice(token);
  }

  /** Renderer submitted the user's choice (also used for dismiss/cancel). */
  submit(token: string, choice: ApplicationCloseChoice): void {
    if (!this.lifecycle.isCloseChoiceTokenLive(token)) return; // stale — ignore
    this.clearTimer();
    this.active = false;
    this.deliver(token, choice);
  }

  /** Native fallback choice (owns the decision once shown — T11). */
  private async runNativeFallback(token: string): Promise<void> {
    // T11 (2026-09-21 audit): the native flow takes ownership the moment
    // it opens — invalidate the renderer token FIRST so a renderer dialog
    // surfacing after the timeout cannot race the native decision, and a
    // concurrent renderer submission is rejected as stale by the service.
    this.lifecycle.cancelCloseChoice(token);
    try {
      const choice = await this.ports.showNativeFallback(
        this.lifecycle.isBackgroundAvailable()
      );
      if (this.lifecycle.isQuitting()) {
        return; // exit accepted elsewhere while the native dialog was up
      }
      this.active = false;
      this.deliverNative(choice);
    } catch (err) {
      log.error(
        "[close-choice] native fallback failed:",
        err instanceof Error ? err.message : String(err)
      );
      // Cancel: keep the window open (dismiss semantics); the token was
      // already consumed when native ownership began (T11).
      this.active = false;
    }
  }

  /**
   * T11: deliver a native decision through a FRESH single-use token so a
   * late renderer submission can never interfere: begin a new token,
   * submit the native choice against it in the same tick.
   */
  private deliverNative(choice: ApplicationCloseChoice): void {
    const issued = this.lifecycle.beginCloseChoice();
    if (issued.result !== "issued") return;
    const result = this.lifecycle.submitCloseChoice(issued.token, choice);
    if (result.result === "accepted" && result.choice === "hide") {
      this.ports.hideWindow();
    }
  }

  /** Stop the flow entirely (exit accepted elsewhere invalidated the token). */
  abort(): void {
    this.clearTimer();
    this.active = false;
  }

  private deliver(token: string, choice: ApplicationCloseChoice): void {
    const result = this.lifecycle.submitCloseChoice(token, choice);
    if (result.result === "accepted" && result.choice === "hide") {
      this.ports.hideWindow();
    }
  }

  private clearTimer(): void {
    if (this.ackTimer !== null) {
      const { clearTimeoutFn = clearTimeout } = this.ports;
      clearTimeoutFn(this.ackTimer);
      this.ackTimer = null;
    }
  }
}
