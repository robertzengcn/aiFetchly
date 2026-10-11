/**
 * MCPSessionPool — persistent MCP client sessions (design §4.2).
 *
 * The legacy path connected and disconnected a client per tool invocation,
 * reloading everything on each call. The pool keys sessions by server
 * identity + resolved launch configuration hash + trust generation, reuses a
 * live session for repeated calls, closes sessions after a configurable idle
 * timeout, and never reuses a session whose grants, paths, version, or owner
 * changed.
 *
 * Computer Use sessions are pinned for their lifetime and closed explicitly
 * by the supervisor on stop (see `pinSession` / `releasePinned`).
 */
import { createHash, randomUUID } from "crypto";
import { MCPClient, type MCPClientConfig } from "@/modules/MCPClient";
import { log } from "@/modules/Logger";

/** Factory abstraction so tests can substitute a fake client. */
export type McpClientFactory = (config: MCPClientConfig) => MCPClient;

const defaultFactory: McpClientFactory = (config) => new MCPClient(config);

export interface McpSessionKey {
  /** Stable server identity (e.g. `server:<id>` or `plugin:<name>`). */
  readonly serverId: string;
  /** Resolved launch configuration (command/args/env/cwd) feeding the hash. */
  readonly launchConfig: MCPClientConfig;
  /** Trust generation; bump to invalidate all sessions for this server. */
  readonly trustGeneration: number;
}

interface PooledSession {
  readonly key: string;
  readonly client: MCPClient;
  pinned: boolean;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface MCPSessionPoolOptions {
  /** Idle lifetime for an unpinned session (ms). Default 5 minutes. */
  idleTimeoutMs?: number;
  /** Factory for new clients (tests). */
  clientFactory?: McpClientFactory;
  /** Clock override (tests). */
  now?: () => number;
}

export interface PooledMcpSession {
  readonly client: MCPClient;
  /** Release the session back to the pool (records use, schedules idle close). */
  release: () => void;
}

/**
 * Session pool over `MCPClient`. NOT keyed by transport-agnostic identity:
 * callers must include everything that changes process identity (paths,
 * versions, owner) in `launchConfig` so a stale session can never be reused.
 */
export class MCPSessionPool {
  private readonly sessions = new Map<string, PooledSession>();
  private readonly idleTimeoutMs: number;
  private readonly clientFactory: McpClientFactory;
  private readonly now: () => number;
  private disposed = false;

  constructor(options: MCPSessionPoolOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000;
    this.clientFactory = options.clientFactory ?? defaultFactory;
    this.now = options.now ?? (() => Date.now());
  }

  /** Deterministic key: identity + launch-config hash + trust generation. */
  static buildKey(key: McpSessionKey): string {
    const launch = key.launchConfig;
    const hashInput = JSON.stringify({
      transport: launch.transport,
      command: launch.command ?? null,
      args: launch.args ?? null,
      env: launch.env ?? null,
      cwd: launch.cwd ?? null,
      host: launch.host ?? null,
      port: launch.port ?? null,
      ownerId: launch.ownerId ?? null,
    });
    const configHash = createHash("sha256").update(hashInput).digest("hex");
    return `${key.serverId}|${configHash}|${key.trustGeneration}`;
  }

  /**
   * Acquire a live session: reuse when the exact key exists and is healthy,
   * otherwise create + connect a new client. The returned handle must be
   * released; a `release` of a removed session is a no-op.
   */
  async acquire(key: McpSessionKey): Promise<PooledMcpSession> {
    if (this.disposed) {
      throw new Error("MCPSessionPool is disposed");
    }
    const poolKey = MCPSessionPool.buildKey(key);
    const existing = this.sessions.get(poolKey);
    if (existing) {
      existing.lastUsedAt = this.now();
      this.clearIdleTimer(existing);
      if (!existing.pinned) this.scheduleIdleClose(poolKey);
      return {
        client: existing.client,
        release: () => this.touch(poolKey),
      };
    }

    const client = this.clientFactory(key.launchConfig);
    await client.connect();
    const session: PooledSession = {
      key: poolKey,
      client,
      pinned: false,
      lastUsedAt: this.now(),
      idleTimer: null,
    };
    this.sessions.set(poolKey, session);
    this.scheduleIdleClose(poolKey);
    return {
      client,
      release: () => this.touch(poolKey),
    };
  }

  /**
   * Pin a session for an exclusive owner (Computer Use supervisor). Pinned
   * sessions never idle-close; the owner must `releasePinned` or `remove`.
   */
  async pinSession(key: McpSessionKey): Promise<PooledMcpSession> {
    const poolKey = MCPSessionPool.buildKey(key);
    const existing = this.sessions.get(poolKey);
    if (existing) {
      if (existing.pinned) {
        throw new Error(`MCP session ${key.serverId} is already pinned`);
      }
      existing.pinned = true;
      existing.lastUsedAt = this.now();
      this.clearIdleTimer(existing);
      return {
        client: existing.client,
        release: () => this.touch(poolKey),
      };
    }
    const acquired = await this.acquire(key);
    const session = this.sessions.get(poolKey);
    if (session) {
      session.pinned = true;
      this.clearIdleTimer(session);
    }
    return acquired;
  }

  /** Unpin a pinned session; it becomes eligible for idle close again. */
  releasePinned(key: McpSessionKey): void {
    const poolKey = MCPSessionPool.buildKey(key);
    const session = this.sessions.get(poolKey);
    if (!session) return;
    session.pinned = false;
    session.lastUsedAt = this.now();
    this.scheduleIdleClose(poolKey);
  }

  /** Close and drop one session (by key). Safe when absent. */
  async remove(key: McpSessionKey): Promise<void> {
    const poolKey = MCPSessionPool.buildKey(key);
    await this.evict(poolKey);
  }

  /** Invalidate every session for a server (any config/trust generation). */
  async invalidateServer(serverId: string): Promise<void> {
    const victims = [...this.sessions.keys()].filter(
      (poolKey) => poolKey.split("|")[0] === serverId
    );
    await Promise.all(victims.map((poolKey) => this.evict(poolKey)));
  }

  /** Number of live sessions (tests/monitoring). */
  get size(): number {
    return this.sessions.size;
  }

  /** Close every session and stop the pool. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const keys = [...this.sessions.keys()];
    await Promise.all(keys.map((poolKey) => this.evict(poolKey)));
  }

  private touch(poolKey: string): void {
    const session = this.sessions.get(poolKey);
    if (!session) return;
    session.lastUsedAt = this.now();
    if (!session.pinned) this.scheduleIdleClose(poolKey);
  }

  private scheduleIdleClose(poolKey: string): void {
    const session = this.sessions.get(poolKey);
    if (!session || session.pinned || this.disposed) return;
    this.clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      void this.evict(poolKey).catch((error) => {
        log.warn(
          `[mcp-session-pool] idle close failed for ${poolKey.split("|")[0]}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }, this.idleTimeoutMs);
    // Do not hold the event loop open for idle reaping.
    session.idleTimer.unref?.();
  }

  private clearIdleTimer(session: PooledSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  private async evict(poolKey: string): Promise<void> {
    const session = this.sessions.get(poolKey);
    if (!session) return;
    this.sessions.delete(poolKey);
    this.clearIdleTimer(session);
    await session.client.disconnect().catch(() => {
      /* best-effort: disconnect escalates to SIGKILL internally */
    });
  }
}

/** Fresh correlation id for session-scoped traces. */
export function newMcpCorrelationId(): string {
  return randomUUID();
}
