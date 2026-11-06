import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F21: the live browser-batch control card is MOUNTED in the chat and its
 * controls call the validated task-control IPC.
 */

const batchListeners = new Set<(event: unknown) => void>();
const invokeMock = vi.fn();

vi.mock("@/views/api/managedBrowser", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/views/api/managedBrowser")>();
  return {
    ...original,
    onManagedBrowserBatchEvent: (cb: (event: unknown) => void) => {
      batchListeners.add(cb);
      return () => batchListeners.delete(cb);
    },
    browserBatchReturnNow: (input: { batchId: string }) => {
      invokeMock("BROWSER_BATCH_RETURN_NOW", input);
      return Promise.resolve({ ok: true });
    },
    pauseBrowserTask: (input: { taskId: string }) => {
      invokeMock("BROWSER_TASK_PAUSE", input);
      return Promise.resolve({ ok: true });
    },
    resumeBrowserTask: (input: { taskId: string }) => {
      invokeMock("BROWSER_TASK_RESUME", input);
      return Promise.resolve({ ok: true });
    },
    stopBrowserTask: (input: { taskId: string }) => {
      invokeMock("BROWSER_TASK_STOP", input);
      return Promise.resolve({ ok: true });
    },
  };
});

import BrowserControlCards from "@/views/components/aiChatV2/BrowserControlCards.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      browserTasks: {
        batchTitle: "Parallel browser tasks",
        returnResultsNow: "Return results now",
        taskRunning: "Running",
        taskWaitingForYou: "Waiting for you",
        taskPaused: "Paused by you",
        taskCompleted: "Completed",
        taskFailed: "Failed",
        taskCancelled: "Stopped",
        pause: "Pause",
        resume: "Resume",
        stop: "Stop",
      },
    },
  },
});

function emit(event: unknown): void {
  for (const listener of batchListeners) {
    listener(event);
  }
}

function mountCard() {
  return mount(BrowserControlCards, {
    global: { plugins: [i18n] },
  });
}

beforeEach(() => {
  batchListeners.clear();
  invokeMock.mockClear();
});

describe("BrowserControlCards (F21 live batch card)", () => {
  it("renders nothing before any batch event", () => {
    const wrapper = mountCard();
    expect(wrapper.findComponent({ name: "BrowserTaskBatchCard" }).exists()).toBe(
      false
    );
  });

  it("mounts the batch card with live task rows from batch events", async () => {
    const wrapper = mountCard();
    emit({ batchId: "batch_live1", phase: "started" });
    emit({
      batchId: "batch_live1",
      phase: "task",
      taskId: "batch_live1:0",
      label: "Find supplier prices",
      state: "running",
    });
    emit({
      batchId: "batch_live1",
      phase: "task",
      taskId: "batch_live1:1",
      label: "Check competitor page",
      state: "running",
    });
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("batchId")).toBe("batch_live1");
    expect(card.props("tasks")).toHaveLength(2);
    // A per-task state update replaces the row (no duplicates).
    emit({
      batchId: "batch_live1",
      phase: "task",
      taskId: "batch_live1:0",
      state: "completed",
      summary: "found 3 prices",
    });
    await flushPromises();
    expect(card.props("tasks")).toHaveLength(2);
    expect(
      (card.props("tasks") as Array<{ state: string }>)[0]!.state
    ).toBe("completed");
  });

  it("control verbs call the validated task-control IPC", async () => {
    const wrapper = mountCard();
    emit({ batchId: "batch_live2", phase: "started" });
    emit({
      batchId: "batch_live2",
      phase: "task",
      taskId: "batch_live2:0",
      label: "task a",
      state: "running",
    });
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    card.vm.$emit("returnNow", "batch_live2");
    card.vm.$emit("pause", { taskId: "batch_live2:0" });
    card.vm.$emit("resume", { taskId: "batch_live2:0" });
    card.vm.$emit("stop", { taskId: "batch_live2:0" });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("BROWSER_BATCH_RETURN_NOW", {
      batchId: "batch_live2",
    });
    expect(invokeMock).toHaveBeenCalledWith("BROWSER_TASK_PAUSE", {
      taskId: "batch_live2:0",
    });
    expect(invokeMock).toHaveBeenCalledWith("BROWSER_TASK_RESUME", {
      taskId: "batch_live2:0",
    });
    expect(invokeMock).toHaveBeenCalledWith("BROWSER_TASK_STOP", {
      taskId: "batch_live2:0",
    });
  });
});
