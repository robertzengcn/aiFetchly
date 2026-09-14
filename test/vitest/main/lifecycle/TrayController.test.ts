import { describe, expect, it, vi } from "vitest";
import {
  TrayController,
  type TrayControllerPorts,
  type TrayLike,
  type TrayMenuLike,
  type TrayLabels,
} from "@/main-process/lifecycle/TrayController";
import {
  resolveTrayLabels,
  trayLabelsForLocale,
  TRAY_LOCALE_CODES,
} from "@/main-process/lifecycle/TrayLocale";

/**
 * TrayController tests (design §9, PRD FR-02/03/07, AC-02/03/10):
 * readiness gating, restore/exit routing, failure fallbacks, exactly-once
 * destroy, and locale-driven menu rebuilds.
 */

interface MenuActions {
  open: () => void;
  exit: () => void;
}

class FakeTray implements TrayLike {
  tooltip = "";
  menu: MenuActions | null = null;
  destroyed = false;
  readonly listeners = new Map<string, Array<() => void>>();
  clickListenerCount = 0;

  setToolTip(tooltip: string): void {
    this.tooltip = tooltip;
  }
  setContextMenu(menu: TrayMenuLike): void {
    // The controller hands us a menu; keep its action callbacks reachable
    // for assertions by duck-typing onto the stored object.
    this.menu = menu as unknown as MenuActions;
  }
  on(event: string, listener: () => void): unknown {
    if (event === "click") this.clickListenerCount += 1;
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }
  removeListener(): unknown {
    return this;
  }
  destroy(): void {
    this.destroyed = true;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

function makePorts(
  tray: FakeTray | null,
  overrides: Partial<TrayControllerPorts> = {}
): TrayControllerPorts & {
  restore: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
} {
  const restore = vi.fn();
  const exit = vi.fn();
  return {
    createTray: (iconPath: string | null) => {
      void iconPath;
      return tray;
    },
    buildMenu: (labels, actions) => {
      void labels;
      return {
        popUpContextMenu: () => undefined,
        open: actions.open,
        exit: actions.exit,
      } as unknown as TrayMenuLike & MenuActions;
    },
    restoreWindow: restore,
    requestExit: exit,
    labels: () => trayLabelsForLocale("en"),
    iconCandidates: () => ["/tmp/icon.png"],
    ...overrides,
    restore,
    exit,
  };
}

describe("TrayController", () => {
  it("initializes, reports ready, and wires click-to-restore", () => {
    const tray = new FakeTray();
    const ports = makePorts(tray);
    const controller = new TrayController(ports);
    expect(controller.initialize()).toBe(true);
    expect(controller.isReady()).toBe(true);

    tray.click();
    expect(ports.restore).toHaveBeenCalledTimes(1);

    // Menu Open also restores.
    tray.menu?.open();
    expect(ports.restore).toHaveBeenCalledTimes(2);
    expect(ports.exit).not.toHaveBeenCalled();
  });

  it("menu Exit routes to the shared exit path (FR-04)", () => {
    const tray = new FakeTray();
    const ports = makePorts(tray);
    const controller = new TrayController(ports);
    controller.initialize();
    tray.menu?.exit();
    expect(ports.exit).toHaveBeenCalledTimes(1);
  });

  it("creation failure keeps background unavailable — app stays reachable (AC-10)", () => {
    const ports = makePorts(null);
    const controller = new TrayController(ports);
    expect(controller.initialize()).toBe(false);
    expect(controller.isReady()).toBe(false);
  });

  it("a throwing createTray never propagates (startup-safe)", () => {
    const ports = makePorts(new FakeTray());
    const mutablePorts = ports as unknown as {
      createTray: (iconPath: string | null) => TrayLike | null;
    };
    mutablePorts.createTray = () => {
      throw new Error("no tray host");
    };
    const controller = new TrayController(ports);
    expect(controller.initialize()).toBe(false);
    expect(controller.isReady()).toBe(false);
  });

  it("destroy is exactly-once and idempotent", () => {
    const tray = new FakeTray();
    const controller = new TrayController(makePorts(tray));
    controller.initialize();
    controller.destroy();
    controller.destroy();
    expect(tray.destroyed).toBe(true);
    expect(controller.isReady()).toBe(false);
    // A destroyed controller ignores restore.
    tray.click();
  });

  it("rebuildMenu refreshes tooltip + labels for locale changes", () => {
    const tray = new FakeTray();
    let labels: TrayLabels = trayLabelsForLocale("en");
    const ports = makePorts(tray, {
      labels: () => labels,
    });
    const controller = new TrayController(ports);
    controller.initialize();
    expect(tray.tooltip).toBe("AiFetchly");
    labels = trayLabelsForLocale("zh");
    controller.rebuildMenu();
    expect(tray.tooltip).toBe("AiFetchly");
    expect(tray.menu?.open).toBeTypeOf("function");
  });
});

describe("TrayLocale", () => {
  it("provides labels for every supported locale code", () => {
    expect(TRAY_LOCALE_CODES).toEqual(
      expect.arrayContaining(["en", "zh", "es", "fr", "de", "ja"])
    );
    for (const code of TRAY_LOCALE_CODES) {
      const labels = trayLabelsForLocale(code);
      expect(labels.tooltip.length).toBeGreaterThan(0);
      expect(labels.open.length).toBeGreaterThan(0);
      expect(labels.exit.length).toBeGreaterThan(0);
    }
  });

  it("falls back to English for unknown/absent locales", () => {
    expect(trayLabelsForLocale("xx").open).toBe("Open AiFetchly");
    expect(trayLabelsForLocale(null).open).toBe("Open AiFetchly");
    expect(trayLabelsForLocale(undefined).open).toBe("Open AiFetchly");
  });

  it("resolveTrayLabels reads the persisted preference and never throws", async () => {
    const labels = await resolveTrayLabels(async () => "zh");
    expect(labels.open).toBe("打开 AiFetchly");
    const fallback = await resolveTrayLabels(() => {
      throw new Error("store unavailable");
    });
    expect(fallback.open).toBe("Open AiFetchly");
  });
});
