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
const batchConfirmListeners = new Set<(request: unknown) => void>();
/** R04: controllable control-IPC refusals (shifted per call). */
const pauseResults: Array<{ ok: boolean; reason?: string }> = [];
const batchConfirmCancelledListeners = new Set<(event: unknown) => void>();

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
    onManagedBrowserBatchConfirmRequest: (cb: (request: unknown) => void) => {
      batchConfirmListeners.add(cb);
      return () => batchConfirmListeners.delete(cb);
    },
    onManagedBrowserBatchConfirmCancelled: (cb: (event: unknown) => void) => {
      batchConfirmCancelledListeners.add(cb);
      return () => batchConfirmCancelledListeners.delete(cb);
    },
    submitBrowserBatchConfirm: (input: unknown) => {
      invokeMock("MANAGED_BROWSER_SUBMIT_BATCH_CONFIRM", input);
      return Promise.resolve({ accepted: true });
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
      // R04: controllable refusals — a queued result is consumed if
      // present, otherwise the control succeeds.
      const queued = pauseResults.shift();
      return Promise.resolve(queued ?? { ok: true });
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
import BrowserTaskBatchCard from "@/views/components/aiChatV2/BrowserTaskBatchCard.vue";

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
      common: { cancel: "Cancel", submit: "Resume" },
      browserTasks: {
        batchTitle: "Parallel browser tasks",
        resume_with_instructions: "Resume with instructions",
        resume_instructions_label: "Instructions (optional)",
        returnResultsNow: "Return results now",
        taskRunning: "Running",
        taskWaitingForYou: "Waiting for you",
        taskPaused: "Paused by you",
        taskCompleted: "Completed",
        taskFailed: "Failed",
        taskCancelled: "Stopped",
        taskInterrupted: "Interrupted",
        taskPartial: "Partial",
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

function emitBatchConfirm(request: unknown): void {
  for (const listener of batchConfirmListeners) {
    listener(request);
  }
}

function emitBatchConfirmCancelled(event: unknown): void {
  for (const listener of batchConfirmCancelledListeners) {
    listener(event);
  }
}

beforeEach(() => {
  batchListeners.clear();
  credentialListeners.clear();
  pickerListeners.clear();
  siteConfirmListeners.clear();
  batchConfirmListeners.clear();
  batchConfirmCancelledListeners.clear();
  pauseResults.length = 0;
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

  // W02/D-FR-09: interrupted and partial endings are NOT failures —
  // the row state passes through unchanged and each shows its OWN label.
  it("labels interrupted and partial endings as their own states", async () => {
    const wrapper = mountCard();
    emit({ batchId: "batch_w02", conversationId: "conv-a", phase: "started" });
    emit({
      batchId: "batch_w02",
      phase: "task",
      taskId: "batch_w02:0",
      label: "Return-now task",
      state: "interrupted",
    });
    emit({
      batchId: "batch_w02",
      phase: "task",
      taskId: "batch_w02:1",
      label: "Verification miss",
      state: "partial",
    });
    emit({
      batchId: "batch_w02",
      phase: "task",
      taskId: "batch_w02:2",
      label: "Real failure",
      state: "failed",
    });
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    expect(card.exists()).toBe(true);
    // The card receives the record's real states (no collapse to failed).
    const states = (card.props("tasks") as Array<{ state: string }>).map(
      (row) => row.state
    );
    expect(states).toEqual(["interrupted", "partial", "failed"]);

    // The chip label map: interrupted/partial render their own labels.
    const direct = mount(BrowserTaskBatchCard, {
      props: {
        batchId: "batch_w02",
        tasks: [
          { taskId: "t0", label: "Return-now task", state: "interrupted" },
          { taskId: "t1", label: "Verification miss", state: "partial" },
          { taskId: "t2", label: "Real failure", state: "failed" },
        ] as never,
      },
      global: {
        plugins: [i18n],
        stubs: {
          "v-card": { template: "<div><slot /></div>" },
          "v-card-title": { template: "<div><slot /></div>" },
          "v-card-text": { template: "<div><slot /></div>" },
          "v-spacer": { template: "<span></span>" },
          "v-btn": { template: "<button><slot /></button>" },
          "v-list": { template: "<div><slot /></div>" },
          "v-list-item": {
            template:
              "<div><slot name='prepend' /><slot /><slot name='append' /></div>",
          },
          "v-list-item-title": { template: "<div><slot /></div>" },
          "v-list-item-subtitle": { template: "<div><slot /></div>" },
          "v-chip": { template: "<span><slot /></span>" },
          "v-dialog": { template: "<div><slot /></div>" },
          "v-textarea": { template: "<textarea />" },
        },
      },
    });
    const chips = direct.findAll("[data-testid^='task-state-']");
    expect(chips.length).toBe(3);
    expect(chips[0]!.text()).toBe("Interrupted");
    expect(chips[1]!.text()).toBe("Partial");
    expect(chips[2]!.text()).toBe("Failed");
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

describe("BrowserTaskBatchCard resume-with-instructions dialog (V01/C-FR-04)", () => {
  function mountCardWithTask() {
    const wrapper = mount(BrowserControlCards, {
      global: {
        plugins: [i18n],
        stubs: {
          "v-dialog": {
            props: ["modelValue"],
            template: '<div v-if="modelValue"><slot /></div>',
          },
          "v-card": { template: "<div><slot /></div>" },
          "v-card-title": { template: "<div><slot /></div>" },
          "v-card-text": { template: "<div><slot /></div>" },
          "v-card-actions": { template: "<div><slot /></div>" },
          "v-btn": { template: "<button @click=\"$emit('click')\"><slot /></button>" },
          "v-chip": { template: "<span><slot /></span>" },
          "v-spacer": { template: "<span />" },
          "v-list": { template: "<div><slot /></div>" },
          "v-list-item": {
            template: '<div><slot /><slot name="append" /></div>',
          },
          "v-list-item-title": { template: "<div><slot /></div>" },
        },
      },
    });
    emit({ batchId: "batch_v01", conversationId: "conv-a", phase: "started" });
    emit({
      batchId: "batch_v01",
      phase: "task",
      taskId: "batch_v01:0",
      label: "task a",
      state: "running",
    });
    return wrapper;
  }

  it("the real Resume button opens the instructions dialog (no direct emit)", async () => {
    const wrapper = mountCardWithTask();
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    await card.find("button[data-testid='task-resume-batch_v01:0']").trigger("click");
    await flushPromises();
    // The dialog is open (no resume IPC yet).
    expect(
      wrapper.find("[data-testid='mb-resume-instructions']").exists()
    ).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("BROWSER_TASK_RESUME", expect.anything());
  });

  it("submitting the dialog resumes with the typed instructions", async () => {
    const wrapper = mountCardWithTask();
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    await card.find("button[data-testid='task-resume-batch_v01:0']").trigger("click");
    await wrapper.find("input[data-testid='mb-resume-instructions']").setValue("check the second result");
    await wrapper.find("button[data-testid='mb-resume-confirm']").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith(
      "BROWSER_TASK_RESUME",
      expect.objectContaining({
        taskId: "batch_v01:0",
        instructions: "check the second result",
      })
    );
    // The dialog closes.
    expect(
      wrapper.find("[data-testid='mb-resume-instructions']").exists()
    ).toBe(false);
  });

  it("cancel closes the dialog without resuming", async () => {
    const wrapper = mountCardWithTask();
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    await card.find("button[data-testid='task-resume-batch_v01:0']").trigger("click");
    await wrapper.find("button[data-testid='mb-resume-cancel']").trigger("click");
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalledWith("BROWSER_TASK_RESUME", expect.anything());
    expect(
      wrapper.find("[data-testid='mb-resume-instructions']").exists()
    ).toBe(false);
  });

  it("empty instructions still resume (optional field)", async () => {
    const wrapper = mountCardWithTask();
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    await card.find("button[data-testid='task-resume-batch_v01:0']").trigger("click");
    await wrapper.find("button[data-testid='mb-resume-confirm']").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith(
      "BROWSER_TASK_RESUME",
      expect.objectContaining({ taskId: "batch_v01:0", instructions: "" })
    );
  });
});

// ---------------------------------------------------------------------------
// W08/M-FR-04: batch confirmation card — the batch preview renders for the
// owning conversation only; confirming starts, denying refuses.
// ---------------------------------------------------------------------------

describe("BrowserControlCards batch confirm (W08/M-FR-04)", () => {
  function mountWith(conversationId: string | null) {
    return mount(BrowserControlCards, {
      props: { conversationId },
      global: { plugins: [i18n] },
    });
  }

  const confirmRequest = {
    requestId: "bconfirm-1",
    conversationId: "conv-a",
    tasks: [
      { index: 0, goal: "Find supplier prices", site: "supplier-a.test" },
      { index: 1, goal: "Check competitor page", site: null },
    ],
    createdAt: Date.now(),
  };

  it("mounts the confirm card for the owning conversation with the task preview", async () => {
    const wrapper = mountWith("conv-a");
    emitBatchConfirm(confirmRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserBatchConfirmCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("tasks")).toHaveLength(2);
    // Another conversation does not render it.
    const wrapperOther = mountWith("conv-other");
    expect(
      wrapperOther.findComponent({ name: "BrowserBatchConfirmCard" }).exists()
    ).toBe(false);
  });

  it("confirm submits confirmed true and clears the card", async () => {
    const wrapper = mountWith("conv-a");
    emitBatchConfirm(confirmRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserBatchConfirmCard" });
    card.vm.$emit("confirmed");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("MANAGED_BROWSER_SUBMIT_BATCH_CONFIRM", {
      requestId: "bconfirm-1",
      conversationId: "conv-a",
      confirmed: true,
      cancelled: false,
    });
    expect(
      wrapper.findComponent({ name: "BrowserBatchConfirmCard" }).exists()
    ).toBe(false);
  });

  it("a SPARSE task event never clears the live session or the real label (R04)", async () => {
    const wrapper = mountWith("conv-a");
    emit({ batchId: "batch_sparse", conversationId: "conv-a", phase: "started" });
    // The full initial event carries label + session.
    emit({
      batchId: "batch_sparse",
      conversationId: "conv-a",
      phase: "task",
      taskId: "batch_sparse:0",
      label: "My real task label",
      state: "running",
      sessionId: "mb_live_session",
      summary: "working",
    });
    await flushPromises();
    // A sparse wait-state event omits both.
    emit({
      batchId: "batch_sparse",
      conversationId: "conv-a",
      phase: "task",
      taskId: "batch_sparse:0",
      state: "waiting_for_user",
    });
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    expect(card.exists()).toBe(true);
    const row = (card.props("tasks") as Array<Record<string, unknown>>).find(
      (task) => task.taskId === "batch_sparse:0"
    );
    expect(row?.sessionId).toBe("mb_live_session");
    expect(row?.label).toBe("My real task label");
    expect(row?.state).toBe("waiting_for_user");
  });

  it("a FAILED control IPC surfaces on the row instead of resolving silently (R04)", async () => {
    const wrapper = mountWith("conv-a");
    emit({ batchId: "batch_ctrl", conversationId: "conv-a", phase: "started" });
    emit({
      batchId: "batch_ctrl",
      conversationId: "conv-a",
      phase: "task",
      taskId: "batch_ctrl:0",
      label: "Controllable task",
      state: "running",
      summary: "working",
    });
    await flushPromises();
    // The next pause IPC returns a refusal.
    pauseResults.push({ ok: false, reason: "session_pause_failed" });
    const card = wrapper.findComponent({ name: "BrowserTaskBatchCard" });
    card.vm.$emit("pause", { taskId: "batch_ctrl:0" });
    await flushPromises();
    const row = (card.props("tasks") as Array<Record<string, unknown>>).find(
      (task) => task.taskId === "batch_ctrl:0"
    );
    expect(row?.summary).toContain("session_pause_failed");
    expect(row?.summary).toContain("control refused");
  });

  it("a main-process dismissal (parent Stop / TTL) retires the card without a submit (R07)", async () => {
    const wrapper = mountWith("conv-a");
    emitBatchConfirm(confirmRequest);
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "BrowserBatchConfirmCard" }).exists()
    ).toBe(true);
    // The registry retired the request (no user decision).
    emitBatchConfirmCancelled({
      requestId: "bconfirm-1",
      conversationId: "conv-a",
    });
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "BrowserBatchConfirmCard" }).exists()
    ).toBe(false);
    // No stray submit ever fires for the retired request.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "MANAGED_BROWSER_SUBMIT_BATCH_CONFIRM",
      expect.objectContaining({ requestId: "bconfirm-1" })
    );
  });

  it("deny submits cancelled and clears the card", async () => {
    const wrapper = mountWith("conv-a");
    emitBatchConfirm(confirmRequest);
    await flushPromises();
    const card = wrapper.findComponent({ name: "BrowserBatchConfirmCard" });
    card.vm.$emit("denied");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("MANAGED_BROWSER_SUBMIT_BATCH_CONFIRM", {
      requestId: "bconfirm-1",
      conversationId: "conv-a",
      confirmed: false,
      cancelled: true,
    });
    expect(
      wrapper.findComponent({ name: "BrowserBatchConfirmCard" }).exists()
    ).toBe(false);
  });
});
