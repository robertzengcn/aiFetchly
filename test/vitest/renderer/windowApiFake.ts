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
      send: (_channel: string, _data: unknown): void => {
        /* no-op for renderer-only tests */
      },
      receive: (_channel: string, _cb: (...args: unknown[]) => void): void => {
        /* no-op */
      },
      removeListener: (_channel: string, _cb: (...args: unknown[]) => void): void => {
        /* no-op */
      },
      removeAllListeners: (_channel: string): void => {
        /* no-op */
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
  }
}
