import type { ProcessOps } from "@/main-process/lifecycle/processOps";

/**
 * Deterministic simulated process table for registry/terminator tests.
 * Simulates PID reuse (start-time identity), surviving descendants,
 * permission failures, and unkillable (immune) processes without touching
 * the real OS (design §13 registry/terminator cases).
 */

export interface FakeProc {
  pid: number;
  ppid: number;
  pgid: number;
  startTime: string;
  alive: boolean;
}

export class FakeProcessOps implements ProcessOps {
  platform: NodeJS.Platform = "linux";
  readonly table = new Map<number, FakeProc>();
  private nextPid = 100;
  private startTimeCounter = 1000;
  readonly signalCalls: Array<{ pid: number; signal: string; group: boolean }> = [];
  readonly taskkillCalls: number[] = [];
  /** Pids that ignore signals (simulation of a hung worker). */
  readonly immunePids = new Set<number>();
  /** Pids whose signals fail with a permission error. */
  readonly epermPids = new Set<number>();

  spawn(parentPid: number, opts: { pgid?: number } = {}): number {
    const pid = this.nextPid++;
    const startTime = `t${this.startTimeCounter++}`;
    this.table.set(pid, {
      pid,
      ppid: parentPid,
      pgid: opts.pgid ?? pid,
      startTime,
      alive: true,
    });
    return pid;
  }

  /** Simulate PID reuse: replace the process at `pid` with a fresh identity. */
  recycle(pid: number): void {
    const existing = this.table.get(pid);
    if (!existing) throw new Error(`FakeProcessOps.recycle: ${pid} not in table`);
    existing.startTime = `t${this.startTimeCounter++}`;
  }

  isAlive(pid: number): boolean {
    return this.table.get(pid)?.alive ?? false;
  }

  signal(pid: number, signal: NodeJS.Signals): "ok" | "no-process" | "error" {
    this.signalCalls.push({ pid, signal, group: false });
    if (this.epermPids.has(pid)) return "error";
    const proc = this.table.get(pid);
    if (!proc || !proc.alive) return "no-process";
    if (!this.immunePids.has(pid)) proc.alive = false;
    return "ok";
  }

  signalGroup(pgid: number, signal: NodeJS.Signals): "ok" | "no-process" | "error" {
    this.signalCalls.push({ pid: pgid, signal, group: true });
    const members = [...this.table.values()].filter(
      (p) => p.pgid === pgid && p.alive
    );
    if (members.length === 0) return "no-process";
    for (const member of members) {
      if (
        !this.immunePids.has(member.pid) &&
        !this.epermPids.has(member.pid)
      ) {
        member.alive = false;
      }
    }
    return "ok";
  }

  isGroupAlive(pgid: number): boolean {
    for (const proc of this.table.values()) {
      if (proc.pgid === pgid && proc.alive) return true;
    }
    return false;
  }

  async listChildren(pid: number): Promise<number[]> {
    return [...this.table.values()]
      .filter((p) => p.ppid === pid && p.alive)
      .map((p) => p.pid);
  }

  async readParentPid(pid: number): Promise<number | null> {
    const proc = this.table.get(pid);
    return proc && proc.alive ? proc.ppid : null;
  }

  async readStartTimeIdentity(pid: number): Promise<string | null> {
    const proc = this.table.get(pid);
    return proc && proc.alive ? `linux:${proc.startTime}` : null;
  }

  async runTaskkillTree(pid: number): Promise<"ok" | "no-process" | "error"> {
    this.taskkillCalls.push(pid);
    const root = this.table.get(pid);
    if (!root || !root.alive) return "no-process";
    // taskkill /T walks the whole tree: root + transitive alive children.
    const doomed = [root];
    let frontier = [pid];
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const p of this.table.values()) {
        if (p.alive && frontier.includes(p.ppid) && !doomed.includes(p)) {
          doomed.push(p);
          next.push(p.pid);
        }
      }
      frontier = next;
    }
    for (const p of doomed) {
      if (!this.immunePids.has(p.pid) && !this.epermPids.has(p.pid)) {
        p.alive = false;
      }
    }
    return "ok";
  }
}

/** Flush pending fire-and-forget identity captures (async microtasks). */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
