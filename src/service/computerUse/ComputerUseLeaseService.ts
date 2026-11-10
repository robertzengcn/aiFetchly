/**
 * Computer Use desktop lease (design §10.2, CU-SESSION-02).
 *
 * One desktop-control owner across chats and windows. Competing sessions
 * receive `desktop_busy`. The lease covers the whole interactive desktop of
 * the current user; it relies on the app's single-instance lock for
 * process-level uniqueness and serializes owners inside this process.
 */
import {
  ComputerUseError,
  type ComputerUseSessionSummary,
} from "@/entityTypes/computerUseTypes";

export interface DesktopLeaseHolder {
  /** Session id holding the lease. */
  readonly sessionId: string;
  readonly acquiredAt: number;
}

export class ComputerUseLeaseService {
  private holder: DesktopLeaseHolder | null = null;

  /** Acquire the desktop lease or fail with `desktop_busy`. */
  acquire(sessionId: string, now = Date.now()): DesktopLeaseHolder {
    if (this.holder && this.holder.sessionId !== sessionId) {
      throw new ComputerUseError(
        "desktop_busy",
        "Another Computer Use session already owns desktop control"
      );
    }
    if (!this.holder) {
      this.holder = { sessionId, acquiredAt: now };
    }
    return this.holder;
  }

  /** Release the lease when (and only when) held by this session. */
  release(sessionId: string): boolean {
    if (this.holder?.sessionId === sessionId) {
      this.holder = null;
      return true;
    }
    return false;
  }

  /** Current holder session id, or null. */
  get ownerSessionId(): string | null {
    return this.holder?.sessionId ?? null;
  }

  /** Whether a session currently holds the lease. */
  isHeldBy(sessionId: string): boolean {
    return this.holder?.sessionId === sessionId;
  }

  /** Convenience for diagnostics: describe the holder without internal ids. */
  describeConflict(_incoming: ComputerUseSessionSummary | null): string | null {
    return this.holder ? "desktop-controlled-by-active-session" : null;
  }
}
