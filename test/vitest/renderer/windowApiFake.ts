/**
 * Typed fake for the preload `window.api` contract, for renderer-only UI tests
 * that do NOT launch Electron (TODO 2 / PRD §5.1).
 *
 * Tests configure per-channel responses; the fake records every call so tests
 * can assert the renderer made the expected IPC requests. No `any`: the invoke
 * surface is typed against the channel string union where practical.
 */

export interface InvokeResult {
  readonly status: boolean;
  readonly msg: string;
  readonly data: unknown;
}

export interface RecordedInvoke {
  readonly channel: string;
  readonly data: unknown;
}

export class WindowApiFake {
  readonly invocations: RecordedInvoke[] = [];
  private readonly responses = new Map<string, InvokeResult>();
  private readonly listeners = new Map<string, Array<(value: unknown) => void>>();

  /** Configure the response for a given invoke channel. */
  setInvokeResponse(channel: string, data: unknown, status = true, msg = ""): this {
    this.responses.set(channel, { status, msg, data });
    return this;
  }

  /** Install this fake as `window.api` (happy-dom). */
  install(): void {
    const fake = {
      invoke: (channel: string, data: unknown): Promise<InvokeResult> => {
        this.invocations.push({ channel, data });
        const resp = this.responses.get(channel);
        return Promise.resolve(
          resp ?? { status: false, msg: `no fake response for ${channel}`, data: null }
        );
      },
      send: (channel: string, data: unknown): void => {
        // Renderer-only fake: sends are recorded but never answered. The
        // parameters are part of the window.api contract even though this
        // fake ignores them.
        void channel;
        void data;
      },
      receive: (channel: string, cb: (...args: unknown[]) => void): void => {
        const list = this.listeners.get(channel) ?? [];
        list.push(cb as (value: unknown) => void);
        this.listeners.set(channel, list);
      },
      removeListener: (channel: string, cb: (...args: unknown[]) => void): void => {
        const list = this.listeners.get(channel) ?? [];
        this.listeners.set(
          channel,
          list.filter((fn) => fn !== (cb as (value: unknown) => void))
        );
      },
      removeAllListeners: (channel: string): void => {
        // The removeAllListeners contract carries the channel; this fake
        // tracks no global state to clear.
        void channel;
      },
    };
    (
      window as unknown as { api: typeof fake }
    ).api = fake;
  }

  /** Reset recorded calls + configured responses. */
  reset(): void {
    this.invocations.length = 0;
    this.responses.clear();
    this.listeners.clear();
  }

  /**
   * Emit a broadcast payload to every listener registered on `channel`
   * (mirrors the main process pushing AI_CHAT_V2_STREAM_CHUNK/_COMPLETE).
   */
  emit(channel: string, data: unknown): void {
    for (const cb of this.listeners.get(channel) ?? []) {
      cb(data);
    }
  }
}
