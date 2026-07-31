"use strict";
/**
 * Renderer IPC transport abstraction (PRD FR-3; technical design §10).
 *
 * The renderer API layer used to call `window.api` directly, which only exists
 * under Electron preload. This module introduces a {@link RendererIpcTransport}
 * seam with three implementations:
 *
 *   - {@link ElectronPreloadTransport} — used when `window.api` exists (the
 *     normal Electron desktop app). Behavior is byte-for-byte the legacy path.
 *   - {@link DevBrowserBridgeTransport} — used when running in a normal browser
 *     during development. Talks to the localhost dev bridge over fetch + WS.
 *   - {@link UnavailableIpcTransport} — used when neither is available; every
 *     call throws a clear, actionable error (FR-3.3).
 *
 * Resolution order (technical design §10): window.api first, then dev bridge in
 * `import.meta.env.DEV`, else unavailable.
 */

import {
  getDevBrowserBridgeBaseUrl,
  BRIDGE_PATH_INVOKE,
  BRIDGE_PATH_CONFIG,
  BRIDGE_PATH_EVENTS,
} from "./devBrowserConfig";

/** Shape returned by invoke (mirrors CommonMessage). */
export interface InvokeResult {
  status: boolean;
  msg: string;
  data?: unknown;
}

/** Minimal `window.api` surface this layer depends on. */
interface WindowApi {
  invoke(channel: string, data?: unknown): Promise<InvokeResult | undefined>;
  send(channel: string, data?: unknown): void;
  sendBinary(channel: string, data?: unknown): void;
  receive(channel: string, cb: (value: unknown) => void): void;
  removeListener(channel: string, cb: (value: unknown) => void): void;
  removeAllListeners(channel: string): void;
}

interface AiFetchlyWindow {
  api?: WindowApi;
}

function getWindow(): AiFetchlyWindow | undefined {
  return typeof window !== "undefined"
    ? (window as AiFetchlyWindow)
    : undefined;
}

/** The transport contract the renderer API helpers depend on. */
export interface RendererIpcTransport {
  readonly source: "electron-preload" | "dev-browser-bridge" | "unavailable";
  invoke(channel: string, data?: unknown): Promise<InvokeResult | undefined>;
  invokeBinary(
    channel: string,
    data?: unknown
  ): Promise<InvokeResult | undefined>;
  send(channel: string, data?: unknown): void;
  sendBinary(channel: string, data?: unknown): void;
  receive(channel: string, cb: (value: unknown) => void): void;
  removeListener(channel: string, cb: (value: unknown) => void): void;
  removeAllListeners(channel: string): void;
}

/**
 * Pure transport-kind decision (extracted for unit testing). Resolution order:
 * Electron preload first, then the dev bridge in dev builds, else unavailable.
 */
export function chooseTransportKind(
  hasWindowApi: boolean,
  isDev: boolean
): RendererIpcTransport["source"] {
  if (hasWindowApi) return "electron-preload";
  if (isDev) return "dev-browser-bridge";
  return "unavailable";
}

// ---------------------------------------------------------------------------
// ElectronPreloadTransport — legacy behavior, unchanged.
// ---------------------------------------------------------------------------

class ElectronPreloadTransport implements RendererIpcTransport {
  readonly source = "electron-preload" as const;

  /** Returns the real window.api, or throws with a clear message if missing. */
  private api(): WindowApi {
    const api = getWindow()?.api;
    if (!api || typeof api.invoke !== "function") {
      throw new Error(
        "AiFetchly renderer API is unavailable outside Electron unless the dev browser bridge is enabled."
      );
    }
    return api;
  }

  invoke(channel: string, data?: unknown): Promise<InvokeResult | undefined> {
    // The Electron IPC handlers expect a JSON string (they JSON.parse it).
    return this.api().invoke(channel, serializeForElectron(data));
  }

  invokeBinary(
    channel: string,
    data?: unknown
  ): Promise<InvokeResult | undefined> {
    return this.api().invoke(channel, data);
  }

  send(channel: string, data?: unknown): void {
    this.api().send(channel, serializeForElectron(data));
  }

  sendBinary(channel: string, data?: unknown): void {
    this.api().sendBinary(channel, data);
  }

  receive(channel: string, cb: (value: unknown) => void): void {
    this.api().receive(channel, cb);
  }

  removeListener(channel: string, cb: (value: unknown) => void): void {
    this.api().removeListener(channel, cb);
  }

  removeAllListeners(channel: string): void {
    this.api().removeAllListeners(channel);
  }
}

/** Match the legacy wire shape: objects are JSON-stringified, primitives pass through. */
function serializeForElectron(data: unknown): unknown {
  if (data === undefined) return data;
  if (typeof data === "object") return JSON.stringify(data);
  return data;
}

// ---------------------------------------------------------------------------
// DevBrowserBridgeTransport — fetch + WebSocket to the localhost bridge.
// ---------------------------------------------------------------------------

interface BridgeConfigPayload {
  baseUrl: string;
  token: string;
  allowedOrigin: string;
}

/** Minimal fetch / WebSocket shapes (injectable for tests). */
type FetchLike = typeof fetch;
type WebSocketLike = typeof WebSocket;

export interface DevBrowserBridgeTransportOptions {
  fetch?: FetchLike;
  WebSocket?: WebSocketLike;
  /**
   * Override the bridge base URL. Production leaves this unset (the URL comes
   * from `VITE_AIFETCHLY_DEV_BRIDGE_URL` / default). Tests point it at an
   * ephemeral local bridge.
   */
  baseUrl?: string;
}

class DevBrowserBridgeTransport implements RendererIpcTransport {
  readonly source = "dev-browser-bridge" as const;
  private readonly fetchImpl: FetchLike;
  private readonly webSocketCtor: WebSocketLike;
  private readonly baseUrlOverride?: string;
  private configPromise: Promise<BridgeConfigPayload> | null = null;
  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private readonly channelCallbacks = new Map<
    string,
    Set<(value: unknown) => void>
  >();
  private readonly callbackSubscription = new Map<
    (value: unknown) => void,
    string
  >();
  private counter = 0;

  constructor(opts: DevBrowserBridgeTransportOptions = {}) {
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.webSocketCtor = opts.WebSocket ?? WebSocket;
    this.baseUrlOverride = opts.baseUrl;
  }

  private config(): Promise<BridgeConfigPayload> {
    if (!this.configPromise) this.configPromise = this.fetchConfig();
    return this.configPromise;
  }

  private async fetchConfig(): Promise<BridgeConfigPayload> {
    const base = this.baseUrlOverride ?? getDevBrowserBridgeBaseUrl();
    try {
      const res = await this.fetchImpl(`${base}${BRIDGE_PATH_CONFIG}`);
      if (!res.ok) {
        throw new Error(`bridge config responded ${res.status}`);
      }
      return (await res.json()) as BridgeConfigPayload;
    } catch (err) {
      throw new Error(
        `AiFetchly dev browser bridge is not available at ${base} (${errMessage(
          err
        )}). Start Electron from VS Code with AIFETCHLY_DEV_BROWSER_BRIDGE=1.`
      );
    }
  }

  async invoke(
    channel: string,
    data?: unknown
  ): Promise<InvokeResult | undefined> {
    const cfg = await this.config();
    const requestId = this.nextRequestId();
    const res = await this.fetchImpl(`${cfg.baseUrl}${BRIDGE_PATH_INVOKE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ channel, data, requestId }),
    });
    if (res.status === 401) {
      throw new Error(
        "AiFetchly dev browser bridge: invalid or missing token."
      );
    }
    if (res.status === 403) {
      throw new Error(
        "AiFetchly dev browser bridge: request origin is not allowed."
      );
    }
    if (res.status === 413) {
      throw new Error(
        "AiFetchly dev browser bridge: request payload too large."
      );
    }
    if (!res.ok) {
      throw new Error(
        `AiFetchly dev browser bridge invoke failed (HTTP ${res.status}).`
      );
    }
    return (await res.json()) as InvokeResult;
  }

  async invokeBinary(): Promise<InvokeResult | undefined> {
    // Binary channels (e.g. file uploads) are high-risk and blocked in the MVP
    // allowlist anyway; fail fast with a clear message instead of attempting to
    // JSON-serialize binary data.
    throw new Error(
      "AiFetchly dev browser bridge: binary invoke is not supported in browser mode."
    );
  }

  send(channel: string): void {
    console.warn(
      `[AiFetchly dev-browser] send('${channel}') is not supported in browser mode; use invoke().`
    );
  }

  sendBinary(channel: string): void {
    console.warn(
      `[AiFetchly dev-browser] sendBinary('${channel}') is not supported in browser mode.`
    );
  }

  receive(channel: string, cb: (value: unknown) => void): void {
    let set = this.channelCallbacks.get(channel);
    if (!set) {
      set = new Set();
      this.channelCallbacks.set(channel, set);
    }
    set.add(cb);
    void this.subscribe(channel, cb);
  }

  removeListener(channel: string, cb: (value: unknown) => void): void {
    this.channelCallbacks.get(channel)?.delete(cb);
    void this.unsubscribe(cb);
  }

  removeAllListeners(channel: string): void {
    const set = this.channelCallbacks.get(channel);
    if (!set) return;
    for (const cb of set) void this.unsubscribe(cb);
    this.channelCallbacks.delete(channel);
  }

  private async subscribe(
    channel: string,
    cb: (value: unknown) => void
  ): Promise<void> {
    try {
      await this.ensureWs();
      const subscriptionId = this.nextId("sub");
      this.callbackSubscription.set(cb, subscriptionId);
      this.sendWs({ type: "subscribe", channel, subscriptionId });
    } catch (err) {
      console.warn(
        `[AiFetchly dev-browser] subscribe('${channel}') failed: ${errMessage(
          err
        )}`
      );
    }
  }

  private async unsubscribe(cb: (value: unknown) => void): Promise<void> {
    const subscriptionId = this.callbackSubscription.get(cb);
    if (!subscriptionId) return;
    this.callbackSubscription.delete(cb);
    try {
      this.sendWs({ type: "unsubscribe", subscriptionId });
    } catch {
      /* ws may already be gone */
    }
  }

  private ensureWs(): Promise<void> {
    if (this.ws && this.wsReady) return this.wsReady;
    this.wsReady = (async () => {
      const cfg = await this.config();
      const url = `${cfg.baseUrl.replace(
        /^http/,
        "ws"
      )}${BRIDGE_PATH_EVENTS}?token=${encodeURIComponent(cfg.token)}`;
      this.ws = new this.webSocketCtor(url);
      await new Promise<void>((resolve, reject) => {
        const sock = this.ws;
        if (!sock) return reject(new Error("ws not created"));
        const onOpen = (): void => {
          sock.removeEventListener("open", onOpen);
          resolve();
        };
        const onErr = (): void => {
          sock.removeEventListener("error", onErr);
          reject(new Error("dev browser bridge WebSocket error"));
        };
        sock.addEventListener("open", onOpen);
        sock.addEventListener("error", onErr);
        sock.addEventListener("message", (ev: MessageEvent) =>
          this.onWsMessage(ev)
        );
      });
    })();
    return this.wsReady;
  }

  private onWsMessage(ev: MessageEvent): void {
    let msg: { type: string; channel?: string; payload?: unknown };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    if (msg.type === "event" && typeof msg.channel === "string") {
      const cbs = this.channelCallbacks.get(msg.channel);
      if (cbs) for (const cb of cbs) cb(msg.payload);
    }
  }

  private sendWs(payload: unknown): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private nextRequestId(): string {
    return this.nextId("req");
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }
}

/** Factory for the dev browser bridge transport (used by tests with overrides). */
export function createDevBrowserBridgeTransport(
  opts?: DevBrowserBridgeTransportOptions
): RendererIpcTransport {
  return new DevBrowserBridgeTransport(opts);
}

// ---------------------------------------------------------------------------
// UnavailableIpcTransport — clear failure outside Electron without a bridge.
// ---------------------------------------------------------------------------

export class UnavailableIpcTransport implements RendererIpcTransport {
  readonly source = "unavailable" as const;
  private fail(channel: string): never {
    throw new Error(
      `AiFetchly renderer API (${channel}) is unavailable outside Electron unless the dev browser bridge is enabled.`
    );
  }
  invoke(channel: string): Promise<InvokeResult | undefined> {
    this.fail(channel);
  }
  invokeBinary(channel: string): Promise<InvokeResult | undefined> {
    this.fail(channel);
  }
  send(channel: string): void {
    this.fail(channel);
  }
  sendBinary(channel: string): void {
    this.fail(channel);
  }
  receive(channel: string, _cb?: (value: unknown) => void): void {
    this.fail(channel);
  }
  removeListener(channel: string, _cb?: (value: unknown) => void): void {
    this.fail(channel);
  }
  removeAllListeners(channel: string): void {
    this.fail(channel);
  }
}

// ---------------------------------------------------------------------------
// Resolver + singleton.
// ---------------------------------------------------------------------------

export function resolveIpcTransport(): RendererIpcTransport {
  const kind = chooseTransportKind(
    Boolean(getWindow()?.api && typeof getWindow()?.api?.invoke === "function"),
    Boolean(import.meta.env.DEV)
  );
  switch (kind) {
    case "electron-preload":
      return new ElectronPreloadTransport();
    case "dev-browser-bridge":
      return new DevBrowserBridgeTransport();
    default:
      return new UnavailableIpcTransport();
  }
}

let resolved: RendererIpcTransport | null = null;

/** Returns the process-wide singleton transport, resolving it on first use. */
export function getIpcTransport(): RendererIpcTransport {
  if (!resolved) resolved = resolveIpcTransport();
  return resolved;
}

/** Test-only: reset the cached singleton. */
export function __resetIpcTransportForTests(): void {
  resolved = null;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
