import { describe, expect, it, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useAppShellStore } from "@/views/store/appShell";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { useAppNoticesStore } from "@/views/store/appNotices";
import { useCollectionState } from "@/views/composables/useCollectionState";
import { useSettingSaveState } from "@/views/composables/useSettingSaveState";
import { useAsyncPageState } from "@/views/composables/useAsyncPageState";
import { useUnsavedChangesGuard } from "@/views/composables/useUnsavedChangesGuard";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("appShell mode thresholds (design §10.1, IPR-045)", () => {
  it("selects wide/medium/narrow from measured width", () => {
    const shell = useAppShellStore();
    expect(shell.setModeFromWidth(1440)).toBe("wide");
    expect(shell.setModeFromWidth(1280)).toBe("wide");
    expect(shell.setModeFromWidth(1279)).toBe("medium");
    expect(shell.setModeFromWidth(900)).toBe("medium");
    expect(shell.setModeFromWidth(899)).toBe("narrow");
  });

  it("narrow closes the navigation drawer (opt-in) and clamps inspector width", () => {
    const shell = useAppShellStore();
    shell.setModeFromWidth(1440);
    shell.navigationOpen = true;
    shell.setModeFromWidth(800);
    expect(shell.mode).toBe("narrow");
    expect(shell.navigationOpen).toBe(false);

    shell.setInspectorWidth(9999);
    expect(shell.inspectorWidth).toBe(720);
    shell.setInspectorWidth(100);
    expect(shell.inspectorWidth).toBe(320);
  });
});

describe("appInspector stale-safety (design §9.4/§12.3)", () => {
  it("opens typed targets, closes on owner-route change, keeps same-owner selection", () => {
    const inspector = useAppInspectorStore();
    inspector.open({ kind: "schedule", ownerRoute: "/schedule", scheduleId: 7 });
    expect(inspector.kind).toBe("schedule");

    // Same owner keeps selection.
    inspector.onRouteChanged("/schedule");
    expect(inspector.kind).toBe("schedule");

    // Different owner closes and clears.
    inspector.onRouteChanged("/campaign");
    expect(inspector.target).toBeNull();
  });

  it("rejects stale responses through request generations", () => {
    const inspector = useAppInspectorStore();
    inspector.open({ kind: "schedule", ownerRoute: "/schedule", scheduleId: 1 });
    const gen1 = inspector.beginRequest();
    const gen2 = inspector.beginRequest();
    expect(inspector.isCurrent(gen1)).toBe(false);
    expect(inspector.isCurrent(gen2)).toBe(true);
    // Close invalidates in-flight loads too.
    const gen3 = inspector.beginRequest();
    inspector.close();
    expect(inspector.isCurrent(gen3)).toBe(false);
  });
});

describe("appNotices bounded queue (design §20.1)", () => {
  it("keeps at most five notices with key/action-id payloads only", () => {
    const notices = useAppNoticesStore();
    for (let i = 0; i < 8; i += 1) {
      notices.push({
        tone: "info",
        messageKey: `ui.test.${i}`,
        action: { labelKey: "ui.actions.cancel", actionId: `act-${i}` },
      });
    }
    expect(notices.notices).toHaveLength(5);
    expect(notices.notices[4].messageKey).toBe("ui.test.7");
    expect(notices.notices[4].action?.actionId).toBe("act-7");

    const id = notices.push({ tone: "error", messageKey: "ui.state.errorBody" });
    notices.dismiss(id);
    expect(notices.notices.some((n) => n.id === id)).toBe(false);
  });
});

describe("useCollectionState reset rules (design §13.4/§13.5)", () => {
  it("resets the page on filter and search changes", () => {
    const collection = useCollectionState<{ status: string }>({
      initialFilters: { status: "all" },
    });
    collection.setPage(3);
    collection.setFilter("status", "active");
    expect(collection.query.value.page).toBe(0);

    collection.setPage(2);
    collection.setSearch("hello");
    // Debounced: search applies after the timer.
    expect(collection.query.value.search).toBe("");
    vi.useFakeTimers();
    collection.setSearch("hello");
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    expect(collection.query.value.search).toBe("hello");
    expect(collection.query.value.page).toBe(0);
  });

  it("clearing search resets immediately and selection drops removed keys", () => {
    const collection = useCollectionState<Record<string, unknown>>();
    collection.setSearch("x");
    collection.setSearch("");
    expect(collection.query.value.search).toBe("");

    collection.toggleSelection(1);
    collection.toggleSelection(2);
    expect(collection.hasSelection.value).toBe(true);
    collection.dropSelection([1]);
    expect([...collection.selection.value]).toEqual([2]);
    collection.clearSelection();
    expect(collection.hasSelection.value).toBe(false);
  });
});

describe("useSettingSaveState revision ordering (design §17.3)", () => {
  it("ignores out-of-order completions", () => {
    const setting = useSettingSaveState();
    const rev1 = setting.beginSave();
    const rev2 = setting.beginSave();
    expect(setting.completeSave(rev1, true)).toBe(false); // stale
    expect(setting.state.value).toBe("saving");
    expect(setting.completeSave(rev2, true)).toBe(true);
    expect(setting.state.value).toBe("saved");
    expect(setting.completeSave(rev2, false)).toBe(true);
    expect(setting.state.value).toBe("error");
  });
});

describe("useAsyncPageState generation guard (design §12.3)", () => {
  it("only the newest load may apply its state", async () => {
    const page = useAsyncPageState();
    const gen1 = page.beginLoad();
    const gen2 = page.beginLoad();
    expect(page.isCurrent(gen1)).toBe(false);
    expect(page.isCurrent(gen2)).toBe(true);
    page.applyReady();
    expect(page.loadState.value.state).toBe("ready");
    page.applyEmpty("no-results");
    expect(page.loadState.value).toEqual({ state: "empty", kind: "no-results" });
    page.applyError(true);
    expect(page.loadState.value).toEqual({
      state: "error",
      messageKey: "ui.state.errorBody",
      recoverable: true,
    });
    await nextTick();
  });
});

describe("useUnsavedChangesGuard snapshot diff (IPR-024)", () => {
  it("reports dirty against the baseline and resets after save", async () => {
    const value = ref("a");
    const submitting = ref(false);
    const guard = useUnsavedChangesGuard({
      initialSnapshot: () => value.value,
      currentSnapshot: () => value.value,
      submitting,
    });
    expect(guard.isDirty()).toBe(false);
    value.value = "b";
    expect(guard.isDirty()).toBe(true);
    submitting.value = true;
    expect(guard.isDirty()).toBe(false); // submit path owns its own guard
    submitting.value = false;
    guard.resetBaseline();
    expect(guard.isDirty()).toBe(false);
  });
});
