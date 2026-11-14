import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F21: the live browser-batch control card is MOUNTED in the chat and its
 * controls call the validated task-control IPC.
 */

const batchListeners = new Set<(event: unknown) => void>();
const invokeMock = vi.fn();

const credentialListeners = new Set<(request: unknown) => void>();
const pickerListeners = new Set<(request: unknown) => void>();
const siteConfirmListeners = new Set<(request: unknown) => void>();

vi.mock("@/views/api/managedBrowser", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/views/api/managedBrowser")>();
  return {
    ...original,
    onManagedBrowserBatchEvent: (cb: (event: unknown) => void) => {
      batchListeners.add(cb);
      return () => batchListeners.delete(cb);
    },
    onManagedBrowserCredentialRequest: (cb: (request: unknown) => void) => {
      credentialListeners.add(cb);
      return () => credentialListeners.delete(cb);
    },
    onManagedBrowserAccountPickerRequest: (cb: (request: unknown) => void) => {
      pickerListeners.add(cb);
      return () => pickerListeners.delete(cb);
    },
    onManagedBrowserSiteConfirmRequest: (cb: (request: unknown) => void) => {
      siteConfirmListeners.add(cb);
      return () => siteConfirmListeners.delete(cb);
    },
    submitBrowserSiteConfirm: (input: unknown) => {
      invokeMock("MANAGED_BROWSER_SUBMIT_SITE_CONFIRM", input);
      return Promise.resolve({ accepted: true });
    },
    submitBrowserAccountPicker: (input: unknown) => {
      invokeMock("MANAGED_BROWSER_SUBMIT_ACCOUNT_PICKER", input);
      return Promise.resolve({ accepted: true });
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
      browserSignIn: {
        cardTitle: "Sign in",
        username: "Username",
        password: "Password",
        saveForFuture: "Save",
        submit: "Sign in",
        signMyself: "I'll sign in myself",
        createAccount: "Create account",
        missingFields: "Enter a username and password.",
        expired: "Expired",
        disclosure: "Disclosure",
        pickAccount: "Choose an account",
        pickAccountHint: "Several saved accounts match {domain}.",
        useAnother: "Use another account",
      },
      browserSite: {
        confirmTitle: "Confirm additional login domains",
        confirmHint: "The sign-in for {domain} visited additional domains.",
        warning: "Prompt-injected requests cannot add domains.",
        apply: "Confirm selected domains",
      },
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

function emitCredential(request: unknown): void {
  for (const listener of credentialListeners) {
    listener(request);
  }
}

function emitPicker(request: unknown): void {
  for (const listener of pickerListeners) {
    listener(request);
  }
}

function emitSiteConfirm(request: unknown): void {
  for (const listener of siteConfirmListeners) {
    listener(request);
  }
}

beforeEach(() => {
  batchListeners.clear();
  credentialListeners.clear();
  pickerListeners.clear();
  siteConfirmListeners.clear();
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
    emit({ batchId: "batch_live1", conversationId: "conv-a", phase: "started" });
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
    emit({ batchId: "batch_live2", conversationId: "conv-a", phase: "started" });
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
    // B13/C-FR-04: Take control routes through the pause-or-take-control
    // channel as well.
    card.vm.$emit("takeControl", { taskId: "batch_live2:0" });
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

describe("BrowserControlCards P1 conversation routing", () => {
  function mountWith(conversationId: string | null) {
    return mount(BrowserControlCards, {
      props: { conversationId },
      global: { plugins: [i18n] },
    });
  }

  it("a second batch never discards the first; each shows for its own conversation", async () => {
    const wrapperA = mountWith("conv-a");
    emit({ batchId: "batch_A", conversationId: "conv-a", phase: "started" });
    emit({
      batchId: "batch_A",
      conversationId: "conv-a",
      phase: "task",
      taskId: "batch_A:0",
      label: "batch A task",
      state: "running",
    });
    await flushPromises();
    expect(wrapperA.findComponent({ name: "BrowserTaskBatchCard" }).exists()).toBe(true);

    // Batch B starts in ANOTHER conversation — A stays retained and the
    // conversation-B mount shows B.
    const wrapperB = mountWith("conv-b");
    emit({ batchId: "batch_B", conversationId: "conv-b", phase: "started" });
    emit({
      batchId: "batch_B",
      conversationId: "conv-b",
      phase: "task",
      taskId: "batch_B:0",
      label: "batch B task",
      state: "running",
    });
    await flushPromises();

    // A's card still shows ITS task (not replaced by B).
    const cardA = wrapperA.findComponent({ name: "BrowserTaskBatchCard" });
    expect(cardA.props("batchId")).toBe("batch_A");
    // B's card shows B.
    const cardB = wrapperB.findComponent({ name: "BrowserTaskBatchCard" });
    expect(cardB.props("batchId")).toBe("batch_B");
    // A conversation that owns neither shows nothing.
    const wrapperC = mountWith("conv-other");
    expect(wrapperC.findComponent({ name: "BrowserTaskBatchCard" }).exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// N07: credential card mounting (no-account / username-only sign-in)
// ---------------------------------------------------------------------------

describe("BrowserControlCards credential card (N07)", () => {
  it("mounts the credential card for a live sign-in request", async () => {
    const wrapper = mount(BrowserControlCards, {
      global: { plugins: [i18n] },
    });
    expect(wrapper.findComponent({ name: "BrowserCredentialCard" }).exists()).toBe(
      false
    );
    emitCredential({
      requestId: "cred-1",
      conversationId: "conv-a",
      sessionId: "mb_cred0000001",
      siteDomain: "example.test",
      mode: "login",
      prefillUsername: null,
      passwordOnly: false,
      createdAt: Date.now(),
    });
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserCredentialCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("requestId")).toBe("cred-1");
    expect(card.props("siteDomain")).toBe("example.test");
  });

  it("clears the card after submission", async () => {
    const wrapper = mount(BrowserControlCards, {
      global: { plugins: [i18n] },
    });
    emitCredential({
      requestId: "cred-2",
      conversationId: "conv-a",
      sessionId: "mb_cred0000001",
      siteDomain: "example.test",
      mode: "login",
      prefillUsername: null,
      passwordOnly: false,
      createdAt: Date.now(),
    });
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserCredentialCard" });
    card.vm.$emit("submitted");
    await flushPromises();
    expect(wrapper.findComponent({ name: "BrowserCredentialCard" }).exists()).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// B01: credential-card conversation binding — the event carries
// conversationId, the card receives it, and another conversation never
// renders the request.
// ---------------------------------------------------------------------------

describe("BrowserControlCards credential conversation binding (B01)", () => {
  function mountWith(conversationId: string | null) {
    return mount(BrowserControlCards, {
      props: { conversationId },
      global: { plugins: [i18n] },
    });
  }

  it("passes conversationId from the request event to the card", async () => {
    const wrapper = mountWith("conv-a");
    emitCredential({
      requestId: "cred-b01",
      conversationId: "conv-a",
      sessionId: "mb_cred0000002",
      siteDomain: "example.test",
      mode: "login",
      prefillUsername: "alice",
      passwordOnly: false,
      createdAt: Date.now(),
    });
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserCredentialCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("conversationId")).toBe("conv-a");
  });

  it("a request from another conversation does not render here", async () => {
    const wrapperA = mountWith("conv-a");
    const wrapperB = mountWith("conv-b");
    emitCredential({
      requestId: "cred-b01b",
      conversationId: "conv-b",
      sessionId: "mb_cred0000003",
      siteDomain: "example.test",
      mode: "login",
      prefillUsername: null,
      passwordOnly: false,
      createdAt: Date.now(),
    });
    await flushPromises();
    // conv-a never renders conv-b's request…
    expect(
      wrapperA.findComponent({ name: "BrowserCredentialCard" }).exists()
    ).toBe(false);
    // …and the owning conversation does.
    expect(
      wrapperB.findComponent({ name: "BrowserCredentialCard" }).exists()
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B02: account-picker card mounting and submit routing.
// ---------------------------------------------------------------------------

describe("BrowserControlCards account picker (B02)", () => {
  function mountWith(conversationId: string | null) {
    return mount(BrowserControlCards, {
      props: { conversationId },
      global: { plugins: [i18n] },
    });
  }

  const pickerRequest = {
    requestId: "pick-b02",
    conversationId: "conv-a",
    sessionId: "mb_cred0000004",
    siteDomain: "example.test",
    candidates: [
      { id: 1, user: "alice", name: "alice" },
      { id: 2, user: "bob", name: "bob" },
    ],
    createdAt: Date.now(),
  };

  it("mounts the picker for the owning conversation with candidates", async () => {
    const wrapper = mountWith("conv-a");
    emitPicker(pickerRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserAccountPickerCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("siteDomain")).toBe("example.test");
    expect(card.props("accounts")).toHaveLength(2);
  });

  it("another conversation does not render the picker", async () => {
    const wrapper = mountWith("conv-other");
    emitPicker(pickerRequest);
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "BrowserAccountPickerCard" }).exists()
    ).toBe(false);
  });

  it("selection submits through the validated channel and clears the card", async () => {
    const wrapper = mountWith("conv-a");
    emitPicker(pickerRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserAccountPickerCard" });
    card.vm.$emit("selected", 2);
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("MANAGED_BROWSER_SUBMIT_ACCOUNT_PICKER", {
      requestId: "pick-b02",
      conversationId: "conv-a",
      accountId: 2,
      cancelled: false,
    });
    expect(
      wrapper.findComponent({ name: "BrowserAccountPickerCard" }).exists()
    ).toBe(false);
  });

  it('"use another account" submits accountId null', async () => {
    const wrapper = mountWith("conv-a");
    emitPicker(pickerRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserAccountPickerCard" });
    card.vm.$emit("other");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("MANAGED_BROWSER_SUBMIT_ACCOUNT_PICKER", {
      requestId: "pick-b02",
      conversationId: "conv-a",
      accountId: null,
      cancelled: false,
    });
  });
});

// ---------------------------------------------------------------------------
// B03: extra-domain confirmation card mounting and apply routing.
// ---------------------------------------------------------------------------

describe("BrowserControlCards site confirm (B03)", () => {
  function mountWith(conversationId: string | null) {
    return mount(BrowserControlCards, {
      props: { conversationId },
      global: { plugins: [i18n] },
    });
  }

  const confirmRequest = {
    requestId: "site-b03",
    conversationId: "conv-a",
    sessionId: "mb_signin0005",
    siteId: 42,
    registrableDomain: "example.test",
    proposedDomains: ["auth.partner-sso.test", "cdn.partner-sso.test"],
    createdAt: Date.now(),
  };

  it("mounts the confirm card for the owning conversation with proposed domains", async () => {
    const wrapper = mountWith("conv-a");
    emitSiteConfirm(confirmRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserSiteConfirmCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("registrableDomain")).toBe("example.test");
    expect(card.props("proposedDomains")).toHaveLength(2);
    // Another conversation does not render it.
    const wrapperOther = mountWith("conv-other");
    expect(
      wrapperOther.findComponent({ name: "BrowserSiteConfirmCard" }).exists()
    ).toBe(false);
  });

  it("apply submits the chosen domain subset and clears the card", async () => {
    const wrapper = mountWith("conv-a");
    emitSiteConfirm(confirmRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserSiteConfirmCard" });
    card.vm.$emit("applied", {
      siteId: 42,
      domains: ["auth.partner-sso.test"],
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("MANAGED_BROWSER_SUBMIT_SITE_CONFIRM", {
      requestId: "site-b03",
      conversationId: "conv-a",
      siteId: 42,
      domains: ["auth.partner-sso.test"],
      cancelled: false,
    });
    expect(
      wrapper.findComponent({ name: "BrowserSiteConfirmCard" }).exists()
    ).toBe(false);
  });

  it("cancel submits cancelled with no domains", async () => {
    const wrapper = mountWith("conv-a");
    emitSiteConfirm(confirmRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserSiteConfirmCard" });
    card.vm.$emit("cancelled");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("MANAGED_BROWSER_SUBMIT_SITE_CONFIRM", {
      requestId: "site-b03",
      conversationId: "conv-a",
      siteId: 42,
      domains: [],
      cancelled: true,
    });
  });
});
