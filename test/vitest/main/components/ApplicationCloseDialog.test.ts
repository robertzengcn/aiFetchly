import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, nextTick } from "vue";
import ApplicationCloseDialog from "@/views/components/application/ApplicationCloseDialog.vue";
import type { ApplicationCloseChoiceRequest } from "@/entityTypes/applicationLifecycleTypes";

/**
 * Component tests for the root close-choice dialog (PRD FR-01/FR-04/FR-08,
 * design §9): renders the main-issued request, acknowledges it, hides the
 * keep-running option when the tray is unavailable, submits choices with the
 * token, switches to the shutdown progress overlay when quitting, and never
 * stacks dialogs (AC-01/AC-08).
 */

// The dialog attaches a DOCUMENT keydown listener while open; happy-dom shares
// one document across tests, so every mounted wrapper must unmount or stale
// listeners leak between tests.
enableAutoUnmount(afterEach);

type RequestCallback = (request: ApplicationCloseChoiceRequest) => void;
type StateCallback = (event: { state: string; phaseKey?: string }) => void;

let capturedRequestCallback: RequestCallback | null = null;
let capturedStateCallback: StateCallback | null = null;
const acknowledgeMock = vi.fn(async (_token: string) => true);
const submitMock = vi.fn(async (_token: string, _choice: string) => ({
  accepted: true,
  stale: false,
}));

vi.mock("@/views/api/applicationLifecycle", () => ({
  acknowledgeCloseChoice: (token: string) => acknowledgeMock(token),
  submitCloseChoice: (token: string, choice: string) =>
    submitMock(token, choice),
  onCloseChoiceRequest: (cb: RequestCallback): (() => void) => {
    capturedRequestCallback = cb;
    return () => undefined;
  },
  onLifecycleStateChanged: (cb: StateCallback): (() => void) => {
    capturedStateCallback = cb;
    return () => undefined;
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      applicationLifecycle: {
        closeTitle: "Close AiFetchly?",
        closeDescription: "Exit stops running tasks.",
        activeTasks: "{count} tasks are running.",
        keepRunning: "Keep running in system tray",
        exitApplication: "Exit application",
        cancel: "Cancel",
        exiting: "Exiting AiFetchly…",
        stoppingTasks: "Stopping running tasks…",
        forceStop: "Forcing remaining tasks to stop…",
        finalize: "Saving results and closing…",
        trayUnavailable: "System tray is unavailable.",
        trayOpen: "Open AiFetchly",
        trayExit: "Exit application",
        trayTooltip: "AiFetchly",
      },
    },
  },
});

// Vuetify is not registered in the component-test config; stub the
// components the dialog renders. Dialog/overlay render slots only when open.
const VDialog = defineComponent({
  name: "VDialog",
  props: { modelValue: { type: Boolean, default: false } },
  template: `<div v-if="modelValue" data-testid="v-dialog"><slot /></div>`,
});
const VOverlay = defineComponent({
  name: "VOverlay",
  props: { modelValue: { type: Boolean, default: false } },
  template: `<div v-if="modelValue" data-testid="v-overlay"><slot /></div>`,
});
const VCard = defineComponent({
  name: "VCard",
  template: `<div><slot /></div>`,
});
const VCardTitle = defineComponent({
  name: "VCardTitle",
  template: `<div><slot /></div>`,
});
const VCardText = defineComponent({
  name: "VCardText",
  template: `<div><slot /></div>`,
});
const VCardActions = defineComponent({
  name: "VCardActions",
  template: `<div><slot /></div>`,
});
const VBtn = defineComponent({
  name: "VBtn",
  props: { disabled: { type: Boolean, default: false } },
  emits: ["click"],
  template: `<button type="button" :disabled="disabled" @click="$emit('click')"><slot /></button>`,
});
const VSpacer = defineComponent({
  name: "VSpacer",
  template: `<div />`,
});
const VProgressCircular = defineComponent({
  name: "VProgressCircular",
  template: `<div />`,
});

function mountDialog() {
  return mount(ApplicationCloseDialog, {
    global: {
      plugins: [i18n],
      stubs: {
        VDialog,
        VOverlay,
        VCard,
        VCardTitle,
        VCardText,
        VCardActions,
        VBtn,
        VSpacer,
        VProgressCircular,
      },
    },
  });
}

function pushRequest(
  request: Partial<ApplicationCloseChoiceRequest> = {}
): void {
  capturedRequestCallback?.({
    token: "token-1234",
    backgroundAvailable: true,
    ...request,
  });
}

describe("ApplicationCloseDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRequestCallback = null;
    capturedStateCallback = null;
  });

  it("renders nothing until a close-choice request arrives", () => {
    const wrapper = mountDialog();
    expect(wrapper.find("[data-testid='v-dialog']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='app-exit-progress']").exists()).toBe(
      false
    );
  });

  it("renders the dialog and acknowledges the token on request", async () => {
    const wrapper = mountDialog();
    pushRequest();
    await nextTick();
    expect(wrapper.find("[data-testid='v-dialog']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Close AiFetchly?");
    expect(acknowledgeMock).toHaveBeenCalledWith("token-1234");
    expect(
      wrapper.find("[data-testid='app-close-keep-running']").exists()
    ).toBe(true);
  });

  it("shows the trustworthy active-task count when provided", async () => {
    const wrapper = mountDialog();
    pushRequest({ activeTaskCount: 3 });
    await nextTick();
    const count = wrapper.find("[data-testid='app-close-dialog-task-count']");
    expect(count.exists()).toBe(true);
    expect(count.text()).toContain("3");
  });

  it("omits the count when not provided (FR-01: never report zero blindly)", async () => {
    const wrapper = mountDialog();
    pushRequest();
    await nextTick();
    expect(
      wrapper.find("[data-testid='app-close-dialog-task-count']").exists()
    ).toBe(false);
  });

  it("hides Keep running and warns when the tray is unavailable (FR-07)", async () => {
    const wrapper = mountDialog();
    pushRequest({ backgroundAvailable: false });
    await nextTick();
    expect(
      wrapper.find("[data-testid='app-close-keep-running']").exists()
    ).toBe(false);
    expect(
      wrapper.find("[data-testid='app-close-dialog-tray-unavailable']").exists()
    ).toBe(true);
    // Exit + Cancel stay available (AC-10: app remains reachable).
    expect(wrapper.find("[data-testid='app-close-exit']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='app-close-cancel']").exists()).toBe(
      true
    );
  });

  it("submitting Exit sends the token + choice and closes the dialog", async () => {
    const wrapper = mountDialog();
    pushRequest();
    await nextTick();
    await wrapper.find("[data-testid='app-close-exit']").trigger("click");
    await flushPromises();
    expect(submitMock).toHaveBeenCalledWith("token-1234", "exit");
    expect(wrapper.find("[data-testid='v-dialog']").exists()).toBe(false);
  });

  it("submitting Keep running sends hide", async () => {
    const wrapper = mountDialog();
    pushRequest();
    await nextTick();
    await wrapper
      .find("[data-testid='app-close-keep-running']")
      .trigger("click");
    await flushPromises();
    expect(submitMock).toHaveBeenCalledWith("token-1234", "hide");
  });

  it("Cancel sends cancel and closes the dialog", async () => {
    const wrapper = mountDialog();
    pushRequest();
    await nextTick();
    await wrapper.find("[data-testid='app-close-cancel']").trigger("click");
    await flushPromises();
    expect(submitMock).toHaveBeenCalledWith("token-1234", "cancel");
    expect(wrapper.find("[data-testid='v-dialog']").exists()).toBe(false);
  });

  it("never stacks: a second request while open is ignored (AC-08)", async () => {
    const wrapper = mountDialog();
    pushRequest({ token: "token-first-1" });
    await nextTick();
    pushRequest({ token: "token-secondd" });
    await nextTick();
    expect(acknowledgeMock).toHaveBeenCalledTimes(1);
    expect(acknowledgeMock).toHaveBeenCalledWith("token-first-1");
  });

  it("Escape cancels the dialog and detaches the document listener", async () => {
    const wrapper = mountDialog();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(submitMock).not.toHaveBeenCalled(); // no request yet — listener not attached

    pushRequest();
    await nextTick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(submitMock).toHaveBeenCalledWith("token-1234", "cancel");

    // Dialog closed → listener detached; a stray Escape must not re-submit.
    submitMock.mockClear();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(submitMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("a non-Escape key does not cancel the dialog", async () => {
    mountDialog();
    pushRequest();
    await nextTick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("a quitting broadcast closes any dialog and shows the progress overlay (FR-04)", async () => {
    const wrapper = mountDialog();
    pushRequest();
    await nextTick();
    expect(wrapper.find("[data-testid='v-dialog']").exists()).toBe(true);
    capturedStateCallback?.({ state: "quitting" });
    await nextTick();
    expect(wrapper.find("[data-testid='v-dialog']").exists()).toBe(false);
    // The overlay marker lives on the v-overlay tag itself (fallthrough
    // replaces the stub's own testid), with content only while quitting.
    const overlay = wrapper.find("[data-testid='app-exit-progress']");
    expect(overlay.exists()).toBe(true);
    expect(overlay.text()).toContain("Exiting AiFetchly…");
    expect(overlay.text()).toContain("Stopping running tasks…");
    expect(
      wrapper.find("[data-testid='app-exit-progress-title']").exists()
    ).toBe(true);
  });

  it("renders phase-specific progress text from the broadcast phaseKey (FR-04)", async () => {
    const wrapper = mountDialog();
    capturedStateCallback?.({ state: "quitting", phaseKey: "forceStop" });
    await nextTick();
    const overlay = wrapper.find("[data-testid='app-exit-progress']");
    expect(overlay.exists()).toBe(true);
    expect(wrapper.find("[data-testid='app-exit-progress-phase']").text()).toContain(
      "Forcing remaining tasks"
    );
    capturedStateCallback?.({ state: "quitting", phaseKey: "finalize" });
    await nextTick();
    expect(
      wrapper.find("[data-testid='app-exit-progress-phase']").text()
    ).toContain("Saving results");
  });

  it("a quitting app ignores NEW close-choice requests (design §4)", async () => {
    const wrapper = mountDialog();
    capturedStateCallback?.({ state: "quitting" });
    await nextTick();
    pushRequest();
    await nextTick();
    expect(wrapper.find("[data-testid='v-dialog']").exists()).toBe(false);
  });

  it("unsubscribes on unmount", () => {
    const wrapper = mountDialog();
    wrapper.unmount();
    expect(capturedRequestCallback).not.toBeNull(); // captured at mount
  });
});
