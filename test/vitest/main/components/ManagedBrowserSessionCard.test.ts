import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, nextTick, type Component } from "vue";
import ManagedBrowserSessionCard from "@/views/components/aiChatV2/ManagedBrowserSessionCard.vue";
import type { SafeManagedBrowserStatus } from "@/entityTypes/managedBrowserTypes";

/**
 * ManagedBrowserSessionCard (design §22.2): self-contained card that renders
 * the live managed-browser session with state + controls. All API calls are
 * mocked; assertions cover the state matrix, control visibility, event
 * subscription, and terminal handling.
 */

const apiMocks = vi.hoisted(() => ({
  listActiveSessions: vi.fn(async (): Promise<unknown[]> => []),
  onManagedBrowserStatusChanged: vi.fn(
    (_cb: (s: unknown) => void): (() => void) => () => undefined
  ),
  onManagedBrowserChatNotice: vi.fn(
    (_cb: (n: unknown) => void): (() => void) => () => undefined
  ),
  onManagedBrowserProgress: vi.fn(
    (_cb: (p: unknown) => void): (() => void) => () => undefined
  ),
  onManagedBrowserApprovalRequired: vi.fn(
    (_cb: (r: unknown) => void): (() => void) => () => undefined
  ),
  approveBrowserAction: vi.fn(async (): Promise<unknown> => ({
    recorded: true,
  })),
  requestHandoff: vi.fn(async (): Promise<unknown> => null),
  resumeAfterHandoff: vi.fn(async (): Promise<unknown> => null),
  extendHandoff: vi.fn(async (): Promise<unknown> => null),
  stopManagedBrowser: vi.fn(async (): Promise<unknown> => null),
  verifyManualLogin: vi.fn(async (): Promise<unknown> => null),
  cancelActiveBrowserRequest: vi.fn(async (): Promise<void> => undefined),
  captureSessionScreenshot: vi.fn(async (): Promise<unknown> => ({
    mimeType: "image/jpeg",
    base64: btoa("fakejpegbytes"),
  })),
}));
vi.mock("@/views/api/managedBrowser", () => apiMocks);

function status(
  overrides: Partial<SafeManagedBrowserStatus> = {}
): SafeManagedBrowserStatus {
  return {
    sessionId: "mb_test000000001",
    accountId: 101,
    platformId: 2,
    accountLabel: "My Channel",
    platformLabel: "YouTube",
    state: "ready",
    currentOrigin: "https://www.youtube.com",
    pageTitle: "YouTube",
    pageRevision: 1,
    authenticated: true,
    handoffReason: null,
    handoffExpiresAtEpochMs: null,
    proxyActive: false,
    lastErrorCode: null,
    ...overrides,
  };
}

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      managedBrowser: {
        platform_fallback: "Social",
        proxy_active: "Proxy",
        scope_global: "Shared browser",
        scope_global_hint:
          "This browser session belongs to the account and stays visible when you switch chats.",
        states: {
          ready: "Ready",
          handoff: "You have control",
          user_login_in_progress: "Waiting for your login",
          running: "Running",
          stopping: "Stopping",
          stopped: "Stopped",
          failed: "Failed",
        },
        controls: {
          take_over: "Take over",
          verify_login: "I've finished logging in",
          resume: "Continue task",
          extend: "Extend time",
          stop: "Stop browser",
        },
        errors: { worker_exited: "Browser process ended unexpectedly" },
        notices: {
          login_required: "Login needed",
          login_verified: "Login verified",
          task_resuming: "Resuming the task",
          browser_crashed: "The browser session ended unexpectedly",
        },
      },
    },
  },
});

// Vuetify is not registered in the component-test config — stub the pieces.
const VBtn = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
  },
  emits: ["click"],
  setup(_, { emit }) {
    const onClick = (): void => emit("click");
    return { onClick };
  },
  template: `<button :disabled="disabled" @click="onClick"><slot /></button>`,
});
const VIcon = { props: {}, template: "<i><slot /></i>" };
const VSpacer = { template: "<span />" };

function stubs(): Record<string, Component> {
  return {
    "v-btn": VBtn,
    "v-icon": VIcon,
    "v-spacer": VSpacer,
    ManagedBrowserHandoffDialog: defineComponent({
      props: ["modelValue", "status", "busy"],
      emits: ["update:modelValue", "verify", "extend", "cancel"],
      template:
        "<div data-testid='mb-handoff-dialog-stub' :data-open='String(modelValue)'>" +
        "<button data-testid='mb-handoff-close-stub' @click=\"$emit('update:modelValue', false)\" />" +
        "</div>",
    }),
  };
}

function mountCard() {
  return mount(ManagedBrowserSessionCard, {
    global: { plugins: [i18n], stubs: stubs() },
  });
}

/** Captures the status-event callback handed to the subscription helper. */
function capturedStatusCallback(): (s: SafeManagedBrowserStatus) => void {
  const calls = apiMocks.onManagedBrowserStatusChanged.mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listActiveSessions.mockImplementation(async () => []);
});

describe("ManagedBrowserSessionCard", () => {
  it("renders nothing when no session is active", async () => {
    const wrapper = mountCard();
    await nextTick();
    await nextTick();
    expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
      false
    );
  });

  it("renders account, platform, state, and origin for a live session", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
        true
      )
    );
    expect(wrapper.find("[data-testid='mb-session-account']").text()).toBe(
      "My Channel"
    );
    expect(wrapper.find("[data-testid='mb-session-state']").text()).toContain(
      "Ready"
    );
    expect(wrapper.find("[data-testid='mb-session-origin']").text()).toContain(
      "https://www.youtube.com"
    );
  });

  it("B16: labels the account/global scope so selection changes cannot confuse it", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-scope']").exists()).toBe(
        true
      )
    );
    // Localized scope label (B16): the test bundle carries the key, the
    // six app bundles carry it in every locale (verified by key parity).
    expect(wrapper.find("[data-testid='mb-session-scope']").text()).toContain(
      "Shared browser"
    );
    // The scope chip survives live status updates (the session is
    // account/global state, not per-chat state).
    const push = capturedStatusCallback();
    push(status({ state: "handoff", handoffReason: "user_requested" }));
    await nextTick();
    expect(wrapper.find("[data-testid='mb-session-scope']").exists()).toBe(
      true
    );
    // Actions still target the session/account identity, not the selection.
    await wrapper.find("[data-testid='mb-btn-stop']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.stopManagedBrowser).toHaveBeenCalledWith(
        "mb_test000000001",
        "user_stop"
      )
    );
  });

  it("updates live from the status-changed event and hides on terminal", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => []);
    const wrapper = mountCard();
    await nextTick();
    const push = capturedStatusCallback();

    push(status({ state: "handoff", handoffReason: "user_requested" }));
    await nextTick();
    expect(wrapper.find("[data-testid='mb-session-state']").text()).toContain(
      "You have control"
    );

    push(status({ state: "stopped" }));
    await nextTick();
    expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
      false
    );
  });

  it("FR-P0-013: the handoff dialog auto-opens in handoff states", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => []);
    const wrapper = mountCard();
    await nextTick();
    const dialog = () =>
      wrapper.find("[data-testid='mb-handoff-dialog-stub']");
    expect(dialog().exists()).toBe(false);

    capturedStatusCallback()(status({ state: "handoff" }));
    await nextTick();
    expect(dialog().exists()).toBe(true);
    expect(dialog().attributes("data-open")).toBe("true");
  });

  it("FR-HANDOFF-CLOSE: dismissing the dialog stays dismissed across status refreshes", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => []);
    const wrapper = mountCard();
    await nextTick();
    const push = capturedStatusCallback();
    const dialog = () =>
      wrapper.find("[data-testid='mb-handoff-dialog-stub']");
    const close = () =>
      wrapper.find("[data-testid='mb-handoff-close-stub']");

    push(status({ state: "handoff" }));
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("true");

    await close().trigger("click");
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("false");

    // A handoff status refresh (e.g. countdown update) must NOT reopen it.
    push(status({ state: "handoff" }));
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("false");
    // The card keeps all handoff controls while the dialog is dismissed.
    expect(
      wrapper.find("[data-testid='mb-btn-verify-login']").exists()
    ).toBe(true);
    expect(
      wrapper.find("[data-testid='mb-btn-extend']").exists()
    ).toBe(true);
  });

  it("FR-HANDOFF-CLOSE: leaving the handoff states re-arms auto-open", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => []);
    const wrapper = mountCard();
    await nextTick();
    const push = capturedStatusCallback();
    const dialog = () =>
      wrapper.find("[data-testid='mb-handoff-dialog-stub']");
    const close = () =>
      wrapper.find("[data-testid='mb-handoff-close-stub']");

    push(status({ state: "handoff" }));
    await nextTick();
    await close().trigger("click");
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("false");

    // Back to running (AI resumed) — the dismiss resets silently.
    push(status({ state: "running" }));
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("false");

    // A NEW handoff pops the dialog again (e.g. a later CAPTCHA wall).
    push(status({ state: "handoff", handoffReason: "captcha_sensitive_flow" }));
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("true");
  });

  it("FR-HANDOFF-CLOSE: a stopped session clears the dismiss for the next session", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => []);
    const wrapper = mountCard();
    await nextTick();
    const push = capturedStatusCallback();
    const dialog = () =>
      wrapper.find("[data-testid='mb-handoff-dialog-stub']");
    const close = () =>
      wrapper.find("[data-testid='mb-handoff-close-stub']");

    push(status({ state: "handoff", sessionId: "mb_older00000001" }));
    await nextTick();
    await close().trigger("click");
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("false");

    push(status({ state: "user_login_in_progress", sessionId: "mb_older00000001" }));
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("false");

    // The session now ends; a later NEW session must re-open the dialog.
    push(status({ state: "stopped", sessionId: "mb_older00000001" }));
    await nextTick();
    expect(dialog().exists()).toBe(false);

    push(status({ state: "handoff", sessionId: "mb_test000000002" }));
    await nextTick();
    expect(dialog().attributes("data-open")).toBe("true");
  });

  it("shows takeover + stop in ready state, handoff controls in handoff", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-takeover']").exists()).toBe(
        true
      )
    );
    expect(
      wrapper.find("[data-testid='mb-btn-verify-login']").exists()
    ).toBe(false);

    capturedStatusCallback()(
      status({ state: "user_login_in_progress" })
    );
    await nextTick();
    expect(
      wrapper.find("[data-testid='mb-btn-takeover']").exists()
    ).toBe(false);
    expect(
      wrapper.find("[data-testid='mb-btn-verify-login']").exists()
    ).toBe(true);
    expect(wrapper.find("[data-testid='mb-btn-resume']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='mb-btn-extend']").exists()).toBe(true);
  });

  it("takeover calls requestHandoff and applies the reply", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    apiMocks.requestHandoff.mockImplementation(async () =>
      status({ state: "handoff", handoffReason: "user_requested" })
    );
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-takeover']").exists()).toBe(
        true
      )
    );
    await wrapper.find("[data-testid='mb-btn-takeover']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.requestHandoff).toHaveBeenCalledWith("mb_test000000001")
    );
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-btn-verify-login']").exists()
      ).toBe(true)
    );
  });

  it("verify-login routes to verifyManualLogin", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [
      status({ state: "user_login_in_progress" }),
    ]);
    apiMocks.verifyManualLogin.mockImplementation(async () => status());
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-btn-verify-login']").exists()
      ).toBe(true)
    );
    await wrapper.find("[data-testid='mb-btn-verify-login']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.verifyManualLogin).toHaveBeenCalledWith(
        "mb_test000000001"
      )
    );
  });

  it("stop calls stopManagedBrowser(user_stop) and clears the card", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    apiMocks.stopManagedBrowser.mockImplementation(async () =>
      status({ state: "stopped" })
    );
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-stop']").exists()).toBe(true)
    );
    await wrapper.find("[data-testid='mb-btn-stop']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.stopManagedBrowser).toHaveBeenCalledWith(
        "mb_test000000001",
        "user_stop"
      )
    );
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
        false
      )
    );
  });

  it("R8 P2-6: a late non-terminal status never resurrects a locally stopped session", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-stop']").exists()).toBe(true)
    );
    await wrapper.find("[data-testid='mb-btn-stop']").trigger("click");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
        false
      )
    );

    // A queued status event for the stopped session arrives late.
    capturedStatusCallback()(status({ state: "running" }));
    await nextTick();
    expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
      false
    );
  });

  it("R8 P2-6: a takeover reply confirming a session stopped mid-flight is dropped", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    interface HandoffResolve {
      (s: SafeManagedBrowserStatus | null): void;
    }
    let resolveHandoff: HandoffResolve | undefined;
    apiMocks.requestHandoff.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHandoff = resolve as HandoffResolve;
        })
    );
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-takeover']").exists()).toBe(
        true
      )
    );

    // Take over, but the reply is pending when the session goes terminal.
    await wrapper.find("[data-testid='mb-btn-takeover']").trigger("click");
    await nextTick();
    capturedStatusCallback()(status({ state: "stopped" }));
    await nextTick();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
        false
      )
    );

    // The awaited takeover reply lands after the stop: it must not revive
    // the dead session.
    resolveHandoff?.(status({ state: "handoff", handoffReason: "user_requested" }));
    await nextTick();
    await nextTick();
    expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
      false
    );
  });

  it("renders a localized last-error code line", async () => {
    // Non-terminal state carrying an error code (e.g. a failed cookie
    // refresh keeps the session usable but flagged).
    apiMocks.listActiveSessions.mockImplementation(async () => [
      status({ state: "ready", lastErrorCode: "worker_exited" }),
    ]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-error']").exists()).toBe(
        true
      )
    );
    expect(wrapper.find("[data-testid='mb-session-error']").text()).toContain(
      "Browser process ended unexpectedly"
    );
  });

  it("truncates long account names (no layout overflow)", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [
      status({ accountLabel: "A Very Long Channel Name That Keeps Going And Going" }),
    ]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-account']").exists()).toBe(
        true
      )
    );
    // jsdom does not compute the scoped ellipsis style; assert the
    // truncation class is applied and the full name renders.
    const account = wrapper.find("[data-testid='mb-session-account']");
    expect(
      account.element.getAttribute("class")
    ).toContain("mb-session-card__account");
    expect(account.text()).toContain("A Very Long Channel Name That Keeps");
  });

  it("unsubscribes from status events on unmount", async () => {
    const unsubscribe = vi.fn();
    apiMocks.onManagedBrowserStatusChanged.mockImplementation(
      (_cb: (s: SafeManagedBrowserStatus) => void) => unsubscribe
    );
    const wrapper = mountCard();
    await nextTick();
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});


// ---------------------------------------------------------------------------
// GAP-08: notices, approval dialog, progress, elapsed
// ---------------------------------------------------------------------------

describe("GAP-08 chat wiring", () => {
  function captureCallback(
    mock: ReturnType<typeof vi.fn>
  ): (payload: unknown) => void {
    return mock.mock.calls[mock.mock.calls.length - 1][0] as (
      payload: unknown
    ) => void;
  }

  it("renders the latest three localized chat notices", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(true)
    );
    const push = captureCallback(apiMocks.onManagedBrowserChatNotice);
    for (const [id, type] of [
      ["evt-1", "login_required"],
      ["evt-2", "login_verified"],
      ["evt-3", "task_resuming"],
      ["evt-4", "browser_crashed"],
    ] as const) {
      push({ eventId: id, type, severity: "info" });
    }
    await nextTick();
    const items = wrapper.findAll("[data-testid='mb-session-notices'] li");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.text())).not.toContain("login_required");
    expect(items.map((i) => i.text())).toContain("Resuming the task");
  });

  it("opens the just-in-time approval dialog and records the decision", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(true)
    );
    captureCallback(apiMocks.onManagedBrowserApprovalRequired)({
      sessionId: "mb_test000000001",
      requestId: "call-9",
      programDigest: "b".repeat(64),
      pageRevision: 4,
      riskClass: "consequential_write",
      messageKey: "managedBrowser.approval.required",
      contentSummary: 'click "Publish video"',
    });
    await nextTick();
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-approval-dialog']").exists()
      ).toBe(true)
    );
    expect(wrapper.text()).toContain("Publish video");
    await wrapper.find("[data-testid='mb-approval-allow']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.approveBrowserAction).toHaveBeenCalledWith({
        sessionId: "mb_test000000001",
        requestId: "call-9",
        decision: "approve",
        programDigest: "b".repeat(64),
        pageRevision: 4,
      })
    );
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-approval-dialog']").exists()
      ).toBe(false)
    );
  });

  it("shows the coarse progress line with step counts", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(true)
    );
    captureCallback(apiMocks.onManagedBrowserProgress)({
      sessionId: "mb_test000000001",
      phase: "acting",
      completedSteps: 2,
      totalSteps: 5,
      messageCode: "step_click",
    });
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-progress']").text()).toContain(
        "step_click (2/5)"
      )
    );
    expect(
      wrapper.find("[data-testid='mb-session-elapsed']").exists()
    ).toBe(true);
  });
});


describe("TODO-MSB-003 session header", () => {
  it("shows a distinct Pause AI control that cancels without stopping", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-pause-ai']").exists()).toBe(
        true
      )
    );
    await wrapper.find("[data-testid='mb-btn-pause-ai']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.cancelActiveBrowserRequest).toHaveBeenCalledWith(
        "mb_test000000001"
      )
    );
    // Pause never stops the session.
    expect(apiMocks.stopManagedBrowser).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(
        true
      )
    );
  });

  it("shows the proxy badge only when a proxy is active (no credentials)", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [
      status({ proxyActive: true }),
    ]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-proxy']").exists()).toBe(
        true
      )
    );
    expect(wrapper.find("[data-testid='mb-session-proxy']").text()).toContain(
      "Proxy"
    );
  });

  it("shows whole-session elapsed in the header before any progress", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-session-header-elapsed']").exists()
      ).toBe(true)
    );
  });
});


describe("TODO-MSB-003 screenshot surface", () => {
  it("capture renders an ephemeral thumbnail from a blob URL", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-screenshot']").exists()).toBe(
        true
      )
    );
    await wrapper.find("[data-testid='mb-btn-screenshot']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.captureSessionScreenshot).toHaveBeenCalledWith({
        session_id: "mb_test000000001",
      })
    );
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-session-screenshot']").exists()).toBe(
        true
      )
    );
  });

  it("capture failure (sensitive state) disables the control and shows no image", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [status()]);
    apiMocks.captureSessionScreenshot.mockRejectedValueOnce(
      new Error("action_not_allowed")
    );
    const wrapper = mountCard();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-btn-screenshot']").exists()).toBe(
        true
      )
    );
    await wrapper.find("[data-testid='mb-btn-screenshot']").trigger("click");
    await vi.waitFor(() =>
      expect(
        (wrapper.find("[data-testid='mb-btn-screenshot']").element as HTMLButtonElement)
          .disabled
      ).toBe(true)
    );
    expect(
      wrapper.find("[data-testid='mb-session-screenshot']").exists()
    ).toBe(false);
  });
});


it("renders and stops an account-free public browser session", async () => {
  const publicStatus = status({ accountId: 0, platformId: 0, accountLabel: "Chrome", platformLabel: "Chrome", authenticated: null, currentOrigin: "https://sina.com" });
  apiMocks.listActiveSessions.mockImplementation(async () => [publicStatus]);
  const wrapper = mountCard();
  await vi.waitFor(() => expect(wrapper.find("[data-testid='mb-session-card']").exists()).toBe(true));
  expect(wrapper.find("[data-testid='mb-session-origin']").text()).toBe("https://sina.com");
  expect(wrapper.find("[data-testid='mb-btn-verify-login']").exists()).toBe(false);
  await wrapper.find("[data-testid='mb-btn-stop']").trigger("click");
  expect(apiMocks.stopManagedBrowser).toHaveBeenCalled();
  wrapper.unmount();
});
