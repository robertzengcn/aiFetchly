import { BrowserWindow, screen } from "electron";
import { z } from "zod/v4";
import { getMainWindow } from "@/main-process/mainWindowRegistry";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { USER_AI_DESKTOP_NOTIFY } from "@/config/usersetting";
import { AI_CHAT_V2_OPEN_FROM_NOTIFY } from "@/config/channellist";

export const DesktopNotifyPayloadSchema = z.object({
  type: z.enum(["turn_complete", "plan_ready"]),
  title: z.string().min(1),
  body: z.string(),
  conversationId: z.string().optional(),
  planId: z.string().optional(),
});

export type DesktopNotifyPayload = z.infer<typeof DesktopNotifyPayloadSchema>;

const FLOAT_WIDTH = 320;
const FLOAT_HEIGHT = 96;
const FLOAT_MARGIN = 16;
const AUTO_DISMISS_MS = 6000;
const COALESCE_WINDOW_MS = 3000;

const NOTIFY_PROTOCOL = "aifetchly-desktop-notify";

const TYPE_PRIORITY: Record<DesktopNotifyPayload["type"], number> = {
  plan_ready: 2,
  turn_complete: 1,
};

export type DesktopNotifyDeps = {
  getMainWindow: () => BrowserWindow | null;
  isSettingEnabled: () => Promise<boolean>;
  createWindow: (
    options: Electron.BrowserWindowConstructorOptions
  ) => BrowserWindow;
  getDisplayWorkArea: (main: BrowserWindow | null) => Electron.Rectangle;
  now: () => number;
  sendOpenConversation: (
    main: BrowserWindow,
    conversationId: string | undefined
  ) => void;
};

function defaultIsSettingEnabled(): Promise<boolean> {
  return new SystemSettingModule()
    .getSettingValue(USER_AI_DESKTOP_NOTIFY)
    .then((v) => {
      // Default-on when unset. Toggle UI stores "1"/"0".
      if (v === null || v === undefined || v === "") return true;
      return v !== "0" && v !== "false";
    })
    .catch((err: unknown) => {
      console.error(
        "[desktop-notify] failed to read system_setting toggle:",
        err
      );
      return true;
    });
}

function defaultGetDisplayWorkArea(
  main: BrowserWindow | null
): Electron.Rectangle {
  if (main && !main.isDestroyed()) {
    return screen.getDisplayMatching(main.getBounds()).workArea;
  }
  return screen.getPrimaryDisplay().workArea;
}

function defaultSendOpenConversation(
  main: BrowserWindow,
  conversationId: string | undefined
): void {
  if (main.isDestroyed()) return;
  main.webContents.send(AI_CHAT_V2_OPEN_FROM_NOTIFY, {
    conversationId: conversationId ?? null,
  });
}

function buildFloatHtml(payload: DesktopNotifyPayload): string {
  const title = escapeHtml(payload.title);
  const body = escapeHtml(payload.body);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    margin: 4px;
    padding: 12px 14px;
    border-radius: 10px;
    background: rgba(28, 28, 30, 0.92);
    color: #f5f5f7;
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    cursor: pointer;
    display: flex;
    gap: 10px;
    align-items: flex-start;
    height: ${FLOAT_HEIGHT - 8}px;
    box-sizing: border-box;
    user-select: none;
  }
  .text { flex: 1; min-width: 0; }
  .title { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
  .body { font-size: 12px; opacity: 0.85; margin: 0;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; }
  .close {
    flex: 0 0 auto;
    width: 22px; height: 22px;
    border: none; border-radius: 11px;
    background: rgba(255,255,255,0.12);
    color: #fff; cursor: pointer; font-size: 14px; line-height: 22px;
  }
  .close:hover { background: rgba(255,255,255,0.22); }
</style>
</head>
<body>
  <div class="card" id="card" role="button" tabindex="0">
    <div class="text">
      <p class="title">${title}</p>
      <p class="body">${body}</p>
    </div>
    <button class="close" id="close" type="button" aria-label="Dismiss">×</button>
  </div>
  <script>
    document.getElementById('card').addEventListener('click', function (e) {
      if (e.target && e.target.id === 'close') return;
      location.href = '${NOTIFY_PROTOCOL}://activate';
    });
    document.getElementById('close').addEventListener('click', function (e) {
      e.stopPropagation();
      location.href = '${NOTIFY_PROTOCOL}://dismiss';
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function computeBottomRightBounds(
  workArea: Electron.Rectangle,
  width = FLOAT_WIDTH,
  height = FLOAT_HEIGHT,
  margin = FLOAT_MARGIN
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(workArea.x + workArea.width - width - margin),
    y: Math.round(workArea.y + workArea.height - height - margin),
    width,
    height,
  };
}

export function isMainWindowQuiet(main: BrowserWindow | null): boolean {
  if (!main || main.isDestroyed()) return true;
  if (main.isMinimized()) return true;
  return !main.isFocused();
}

export function coalescePayloads(
  existing: DesktopNotifyPayload,
  incoming: DesktopNotifyPayload
): DesktopNotifyPayload {
  const preferIncoming =
    TYPE_PRIORITY[incoming.type] >= TYPE_PRIORITY[existing.type];
  return preferIncoming ? incoming : existing;
}

export class DesktopNotifyService {
  private static instance: DesktopNotifyService | null = null;

  private readonly deps: DesktopNotifyDeps;
  private floatWin: BrowserWindow | null = null;
  private queue: DesktopNotifyPayload[] = [];
  private showing = false;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private lastShown: {
    conversationId: string;
    at: number;
    payload: DesktopNotifyPayload;
  } | null = null;
  private currentPayload: DesktopNotifyPayload | null = null;

  constructor(deps?: Partial<DesktopNotifyDeps>) {
    this.deps = {
      getMainWindow: deps?.getMainWindow ?? getMainWindow,
      isSettingEnabled: deps?.isSettingEnabled ?? defaultIsSettingEnabled,
      createWindow:
        deps?.createWindow ?? ((options) => new BrowserWindow(options)),
      getDisplayWorkArea: deps?.getDisplayWorkArea ?? defaultGetDisplayWorkArea,
      now: deps?.now ?? (() => Date.now()),
      sendOpenConversation:
        deps?.sendOpenConversation ?? defaultSendOpenConversation,
    };
  }

  static getInstance(): DesktopNotifyService {
    if (!DesktopNotifyService.instance) {
      DesktopNotifyService.instance = new DesktopNotifyService();
    }
    return DesktopNotifyService.instance;
  }

  /** Test-only reset of the singleton. */
  static _resetForTesting(): void {
    if (DesktopNotifyService.instance) {
      DesktopNotifyService.instance.destroy();
    }
    DesktopNotifyService.instance = null;
  }

  async show(raw: unknown): Promise<boolean> {
    const parsed = DesktopNotifyPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[desktop-notify] invalid payload:", parsed.error.message);
      return false;
    }
    const payload = parsed.data;

    try {
      if (!(await this.deps.isSettingEnabled())) {
        return false;
      }
    } catch (err: unknown) {
      console.error("[desktop-notify] setting check failed:", err);
      return false;
    }

    const main = this.deps.getMainWindow();
    if (!isMainWindowQuiet(main)) {
      return false;
    }

    if (this.tryCoalesce(payload)) {
      return true;
    }

    this.queue.push(payload);
    if (!this.showing) {
      await this.pump();
    }
    return true;
  }

  handleActivate(): void {
    const payload = this.currentPayload;
    this.hideFloat();
    const main = this.deps.getMainWindow();
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore();
      if (!main.isVisible()) main.show();
      main.focus();
      this.deps.sendOpenConversation(main, payload?.conversationId);
    }
    void this.pump();
  }

  handleDismiss(): void {
    this.hideFloat();
    void this.pump();
  }

  destroy(): void {
    this.clearDismissTimer();
    this.queue = [];
    this.showing = false;
    this.currentPayload = null;
    if (this.floatWin && !this.floatWin.isDestroyed()) {
      this.floatWin.destroy();
    }
    this.floatWin = null;
  }

  /** Exposed for tests. */
  getQueueLength(): number {
    return this.queue.length;
  }

  /** Exposed for tests. */
  isShowing(): boolean {
    return this.showing;
  }

  private tryCoalesce(incoming: DesktopNotifyPayload): boolean {
    const convId = incoming.conversationId;
    if (!convId || !this.lastShown) return false;
    if (this.lastShown.conversationId !== convId) return false;
    const age = this.deps.now() - this.lastShown.at;
    if (age > COALESCE_WINDOW_MS) return false;

    const merged = coalescePayloads(this.lastShown.payload, incoming);
    this.lastShown = {
      conversationId: convId,
      at: this.deps.now(),
      payload: merged,
    };

    if (this.showing && this.currentPayload) {
      this.currentPayload = merged;
      void this.renderCurrent();
      this.scheduleDismiss();
      return true;
    }

    if (this.queue.length > 0) {
      const idx = this.queue.findIndex((p) => p.conversationId === convId);
      if (idx >= 0) {
        this.queue[idx] = coalescePayloads(this.queue[idx], incoming);
        return true;
      }
    }
    return false;
  }

  private async pump(): Promise<void> {
    if (this.showing) return;
    const next = this.queue.shift();
    if (!next) return;

    this.showing = true;
    this.currentPayload = next;
    if (next.conversationId) {
      this.lastShown = {
        conversationId: next.conversationId,
        at: this.deps.now(),
        payload: next,
      };
    }

    try {
      await this.renderCurrent();
      this.scheduleDismiss();
    } catch (err: unknown) {
      console.error("[desktop-notify] failed to show float:", err);
      this.showing = false;
      this.currentPayload = null;
      void this.pump();
    }
  }

  private async renderCurrent(): Promise<void> {
    const payload = this.currentPayload;
    if (!payload) return;

    const main = this.deps.getMainWindow();
    const workArea = this.deps.getDisplayWorkArea(main);
    const bounds = computeBottomRightBounds(workArea);

    if (!this.floatWin || this.floatWin.isDestroyed()) {
      this.floatWin = this.deps.createWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        focusable: true,
        show: false,
        hasShadow: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });

      this.floatWin.setAlwaysOnTop(true, "screen-saver");
      this.floatWin.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });

      this.floatWin.webContents.on("will-navigate", (event, url) => {
        event.preventDefault();
        this.handleProtocolUrl(url);
      });

      this.floatWin.on("closed", () => {
        this.floatWin = null;
        this.showing = false;
        this.currentPayload = null;
        this.clearDismissTimer();
      });
    } else {
      this.floatWin.setBounds(bounds);
    }

    const html = buildFloatHtml(payload);
    await this.floatWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );
    if (!this.floatWin.isDestroyed()) {
      this.floatWin.showInactive();
    }
  }

  private handleProtocolUrl(url: string): void {
    if (!url.startsWith(`${NOTIFY_PROTOCOL}://`)) return;
    const action = url.slice(`${NOTIFY_PROTOCOL}://`.length).split(/[?#]/)[0];
    if (action === "activate") {
      this.handleActivate();
    } else if (action === "dismiss") {
      this.handleDismiss();
    }
  }

  private hideFloat(): void {
    this.clearDismissTimer();
    this.showing = false;
    this.currentPayload = null;
    if (this.floatWin && !this.floatWin.isDestroyed()) {
      this.floatWin.hide();
    }
  }

  private scheduleDismiss(): void {
    this.clearDismissTimer();
    this.dismissTimer = setTimeout(() => {
      this.handleDismiss();
    }, AUTO_DISMISS_MS);
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }
}
