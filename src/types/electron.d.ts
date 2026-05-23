// Type declarations for Electron APIs that may not be fully typed in some versions
// These augment the existing electron module types

import 'electron';

declare module 'electron' {
  namespace Electron {
    export interface UtilityProcess extends NodeJS.EventEmitter {
      pid: number | null;
      stdout: NodeJS.ReadableStream | null;
      stderr: NodeJS.ReadableStream | null;
      kill(signal?: string): boolean;
      postMessage(message: string, transfer?: MessagePortMain[]): void;
      on(event: 'message', listener: (message: { data: string } | string | unknown) => void): this;
      on(event: 'spawn', listener: () => void): this;
      on(event: 'exit', listener: (code: number | null, signal: string | null) => void): this;
      on(event: 'error', listener: (error: Error) => void): this;
      on(event: string, listener: (...args: unknown[]) => void): this;
    }

    export class MessageChannelMain {
      port1: MessagePortMain;
      port2: MessagePortMain;
    }

    export interface MessagePortMain {
      postMessage(message: unknown, transfer?: MessagePortMain[]): void;
      start(): void;
      on(event: 'message', listener: (event: { data: unknown; ports?: MessagePortMain[] }) => void): void;
      close(): void;
    }
  }

  export const utilityProcess: {
    fork(modulePath: string, args?: string[], options?: {
      stdio?: string | string[];
      execArgv?: string[];
      env?: NodeJS.ProcessEnv;
    }): Electron.UtilityProcess;
  };

  export const MessageChannelMain: typeof Electron.MessageChannelMain;
  export type UtilityProcess = Electron.UtilityProcess;
  export const Menu: typeof import('electron/main').Menu;
  export const shell: typeof import('electron/main').shell;
  export const dialog: typeof import('electron/main').dialog;
  export const contextBridge: typeof import('electron/common').contextBridge;
  export const Notification: typeof import('electron/main').Notification;
  export type IpcMainInvokeEvent = import('electron/main').IpcMainInvokeEvent;
  export type MenuItemConstructorOptions = import('electron/main').MenuItemConstructorOptions;
}
