import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MainWindowStateService,
  type ElectronDisplayLike,
  type MainWindowLike,
  type MainWindowStateStore,
  type ScreenLike,
} from "@/main-process/window/MainWindowStateService";

const primary: ElectronDisplayLike = {
  id: 1,
  scaleFactor: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const secondary: ElectronDisplayLike = {
  id: 2,
  scaleFactor: 1,
  workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
};

function makeScreen(
  displays: ElectronDisplayLike[] = [primary]
): ScreenLike {
  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0] ?? primary,
  };
}

function makeStore(values: Record<string, unknown> = {}): MainWindowStateStore {
  return {
    getValue: (key: string) => values[key],
    setValue: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

class FakeWindow implements MainWindowLike {
  readonly listeners = new Map<string, () => void>();
  maximized = false;
  bounds: { x: number; y: number; width: number; height: number };

  constructor(
    bounds: { x: number; y: number; width: number; height: number } = {
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
    }
  ) {
    this.bounds = { ...bounds };
  }

  on(event: string, listener: () => void): unknown {
    this.listeners.set(event, listener);
    return undefined;
  }

  getNormalBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds };
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  emit(event: string): void {
    this.listeners.get(event)?.();
  }
}

function makeWindow(
  bounds?: { x: number; y: number; width: number; height: number }
): FakeWindow {
  return new FakeWindow(bounds);
}

describe("MainWindowStateService.resolveInitialState (design §14.4/§14.7)", () => {
  it("restores valid saved bounds and the explicit maximized preference", () => {
    const store = makeStore({
      "mainWindow.state.v1": JSON.stringify({
        version: 1,
        maximized: true,
        normalBounds: { x: 40, y: 40, width: 1100, height: 700 },
        displayId: "1",
      }),
    });
    const service = new MainWindowStateService({ store, screen: makeScreen() });
    const state = service.resolveInitialState();
    expect(state.source).toBe("saved");
    expect(state.maximized).toBe(true);
    expect(state.normalBounds).toEqual({
      x: 40,
      y: 40,
      width: 1100,
      height: 700,
    });
  });

  it("falls back to centered defaults on corrupt stored JSON", () => {
    const store = makeStore({ "mainWindow.state.v1": "{not json" });
    const service = new MainWindowStateService({ store, screen: makeScreen() });
    const state = service.resolveInitialState();
    expect(state.source).toBe("default");
    expect(state.maximized).toBe(false);
    expect(state.normalBounds).toEqual({
      x: 320,
      y: 140,
      width: 1280,
      height: 800,
    });
  });

  it("falls back to defaults when the saved display is gone", () => {
    const store = makeStore({
      "mainWindow.state.v1": JSON.stringify({
        version: 1,
        maximized: false,
        normalBounds: { x: 2400, y: 100, width: 1280, height: 800 },
        displayId: "9",
      }),
    });
    // Saved bounds sit on the secondary display which is NOT connected.
    const service = new MainWindowStateService({ store, screen: makeScreen() });
    expect(service.resolveInitialState().source).toBe("default");
  });

  it("E2E mode ignores persisted state and uses deterministic bounds", () => {
    const store = makeStore({
      "mainWindow.state.v1": JSON.stringify({
        version: 1,
        maximized: true,
        normalBounds: { x: 40, y: 40, width: 1100, height: 700 },
        displayId: "1",
      }),
    });
    const service = new MainWindowStateService({
      store,
      screen: makeScreen(),
      e2e: true,
    });
    const state = service.resolveInitialState();
    expect(state.source).toBe("default");
    expect(state.maximized).toBe(false);
    expect(state.normalBounds).toEqual({
      x: 320,
      y: 140,
      width: 1280,
      height: 800,
    });
  });
});

describe("MainWindowStateService persistence (design §14.4/§17.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces move/resize writes", () => {
    const values: Record<string, unknown> = {};
    const store = makeStore(values);
    const service = new MainWindowStateService({ store, screen: makeScreen() });
    const win = makeWindow();
    service.attach(win);

    win.bounds = { x: 10, y: 20, width: 1000, height: 600 };
    win.emit("move");
    win.emit("resize");
    expect(values["mainWindow.state.v1"]).toBeUndefined();

    vi.advanceTimersByTime(250);
    const saved = JSON.parse(String(values["mainWindow.state.v1"])) as {
      version: number;
      normalBounds: { x: number; y: number; width: number; height: number };
      maximized: boolean;
    };
    expect(saved.version).toBe(1);
    expect(saved.normalBounds).toEqual({ x: 10, y: 20, width: 1000, height: 600 });
    expect(saved.maximized).toBe(false);
  });

  it("stores normal bounds, not maximized screen bounds", () => {
    const values: Record<string, unknown> = {};
    const service = new MainWindowStateService({
      store: makeStore(values),
      screen: makeScreen(),
    });
    const win = makeWindow();
    service.attach(win);
    // Window is maximized on screen but remembers normal bounds.
    win.bounds = { x: 5, y: 5, width: 800, height: 600 };
    win.maximized = true;
    win.emit("maximize");
    vi.advanceTimersByTime(250);

    const saved = JSON.parse(String(values["mainWindow.state.v1"])) as {
      normalBounds: { width: number };
      maximized: boolean;
    };
    expect(saved.normalBounds.width).toBe(800);
    expect(saved.maximized).toBe(true);
  });

  it("flushes pending writes on close", () => {
    const values: Record<string, unknown> = {};
    const service = new MainWindowStateService({
      store: makeStore(values),
      screen: makeScreen(),
    });
    const win = makeWindow();
    service.attach(win);
    win.bounds = { x: 7, y: 7, width: 900, height: 500 };
    win.emit("move");
    win.emit("close");
    const saved = JSON.parse(String(values["mainWindow.state.v1"])) as {
      normalBounds: { x: number };
    };
    expect(saved.normalBounds.x).toBe(7);
  });

  it("E2E mode never writes window state", () => {
    const values: Record<string, unknown> = {};
    const service = new MainWindowStateService({
      store: makeStore(values),
      screen: makeScreen(),
      e2e: true,
    });
    const win = makeWindow();
    service.attach(win);
    win.emit("move");
    win.emit("close");
    vi.advanceTimersByTime(500);
    expect(values["mainWindow.state.v1"]).toBeUndefined();
  });

  it("ignores events after detach", () => {
    const values: Record<string, unknown> = {};
    const service = new MainWindowStateService({
      store: makeStore(values),
      screen: makeScreen(),
    });
    const win = makeWindow();
    service.attach(win);
    service.detach();
    win.emit("move");
    vi.advanceTimersByTime(500);
    expect(values["mainWindow.state.v1"]).toBeUndefined();
  });

  it("records the owning display id for multi-display restore", () => {
    const values: Record<string, unknown> = {};
    const service = new MainWindowStateService({
      store: makeStore(values),
      screen: makeScreen([primary, secondary]),
    });
    const win = makeWindow({ x: 2300, y: 100, width: 1280, height: 800 });
    service.attach(win);
    win.emit("move");
    vi.advanceTimersByTime(250);
    const saved = JSON.parse(String(values["mainWindow.state.v1"])) as {
      displayId?: string;
    };
    expect(saved.displayId).toBe("2");
  });
});
