import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Messages from "@/views/components/aiChatV2/AiChatV2Messages.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiChatV2: {} } },
});

/**
 * Build a minimal ChatV2MessageView for tests. Only the fields the template
 * touches are populated; the rest default to whatever the type allows.
 */
function makeMessage(id: string, content: string): ChatV2MessageView {
  return {
    id,
    conversationId: "conv-test",
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: { source: "chat-v2" },
  };
}

/**
 * AiChatV2Messages scrolls via a ref'd scroller div (scrollTop = scrollHeight).
 * happy-dom lays out elements with zero dimensions, so to observe a real
 * scrollTop change we have to stub the scroll geometry on the element. This
 * helper installs getters/setters so the component's onScroll + scrollToBottom
 * logic behaves like a real scrollable container.
 */
function stubScrollGeometry(el: HTMLElement, height: number): void {
  let top = 0;
  Object.defineProperty(el, "scrollHeight", {
    get: () => height,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => 100,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
}

/**
 * Variant of {@link stubScrollGeometry} that counts every `scrollTop` write.
 * Used by the throttling tests to assert how many reflows a token stream
 * triggers: each `scrollTop = scrollHeight` assignment is one forced layout
 * reflow over the whole message DOM. Returns a getter the test reads on
 * demand (the setter closure captures `count` by reference).
 */
function mountScrollCounter(el: HTMLElement, height: number): {
  getWriteCount: () => number;
} {
  let top = 0;
  let count = 0;
  Object.defineProperty(el, "scrollHeight", {
    get: () => height,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => 100,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      count++;
      top = v;
    },
    configurable: true,
  });
  return { getWriteCount: () => count };
}

function mountMessages(messages: ChatV2MessageView[]) {
  return mount(AiChatV2Messages, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Message: { template: "<div class=\"msg\" />" },
        AiChatV2RecoveryStatus: true,
        // Render v-btn as a real <button> so the @click listener lands on a
        // clickable element (same pattern as the AiChatV2 mount tests).
        VBtn: { template: "<button><slot /></button>" },
        VIcon: true,
      },
    },
    props: {
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle" as const,
      reportedMessageIds: new Set<string>(),
    },
  });
}

describe("AiChatV2Messages auto-scroll on history load", () => {
  it("scrollToBottomForce jumps to the bottom even when the user had scrolled up", async () => {
    // Enough messages that the virtual scrollHeight (1000) exceeds the
    // clientHeight (100) — i.e. the list is actually scrollable.
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage(`m-${i}`, `message ${i}`)
    );
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();

    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    stubScrollGeometry(scroller, 1000);

    // Simulate the user scrolling up in a previous conversation: move the
    // scrollTop to the top and dispatch a scroll event so the component's
    // onScroll handler flips pinnedToBottom to false. The normal
    // scrollToBottom() should now be a no-op.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    expect(scroller.scrollTop).toBe(0);

    // The force variant ignores pinnedToBottom and pins back to the bottom.
    const exposed = wrapper.vm as unknown as {
      scrollToBottomForce: () => Promise<void>;
    };
    await exposed.scrollToBottomForce();
    expect(scroller.scrollTop).toBe(1000);

    wrapper.unmount();
  });

  it("does not force-scroll while the user is interacting (regression: force is opt-in)", async () => {
    // Confirms the watch-driven scrollToBottom still respects pinnedToBottom:
    // pushing a new message while scrolled up should NOT auto-scroll.
    const messages = [makeMessage("m-0", "first")];
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();

    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    stubScrollGeometry(scroller, 1000);

    // User scrolled up.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));

    // Append a message via the messages prop (drives the length watcher).
    await wrapper.setProps({ messages: [makeMessage("m-0", "first"), makeMessage("m-1", "second")] });
    await wrapper.vm.$nextTick();

    // Watch-driven scrollToBottom respects pinnedToBottom=false → stays put.
    expect(scroller.scrollTop).toBe(0);

    wrapper.unmount();
  });

  it("shows the float scroll-down button only when scrolled away from the bottom", async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage(`m-${i}`, `message ${i}`)
    );
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();

    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    stubScrollGeometry(scroller, 1000);

    // At the top — far from the bottom — the button must be visible.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="scroll-to-bottom"]').exists()).toBe(true);

    // Scrolling back to the bottom hides it again.
    scroller.scrollTop = 980;
    scroller.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="scroll-to-bottom"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("clicking the float button scrolls to the bottom and hides the button", async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage(`m-${i}`, `message ${i}`)
    );
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();

    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    stubScrollGeometry(scroller, 1000);

    // User scrolled up; button visible.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    const button = wrapper.find('[data-testid="scroll-to-bottom"]');
    expect(button.exists()).toBe(true);

    await button.trigger("click");
    await flushPromises();

    // Click jumps to the latest message and hides the button.
    expect(scroller.scrollTop).toBe(1000);
    expect(wrapper.find('[data-testid="scroll-to-bottom"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("renders the float button as a sibling (not a child) of the scroll container", async () => {
    // Regression guard for the positioning bug: an absolute element inside an
    // overflow:auto container scrolls with the content (bottom:12px lands
    // below the viewport). The button must be a sibling of .v2-messages
    // inside a positioned wrapper, not a child of the scroller.
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage(`m-${i}`, `message ${i}`)
    );
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();

    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    stubScrollGeometry(scroller, 1000);
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    const button = wrapper.find('[data-testid="scroll-to-bottom"]');
    expect(button.exists()).toBe(true);
    // The button's parent must be the wrapper, not the scroller.
    expect(button.element.parentElement).toBe(
      wrapper.find(".v2-messages__wrapper").element
    );

    wrapper.unmount();
  });
});

describe("AiChatV2Messages streaming scroll throttling", () => {
  // The last-message content.length watcher fires on EVERY streamed token
  // (50–100/sec). Before throttling, each token forced one scrollTop write =
  // one full-DOM layout reflow. These tests guard the rAF coalescing: many
  // tokens within one frame collapse into a single write, and a scrolled-up
  // user is never fought.

  /**
   * Mount with a counting scrollTop stub so we can assert the exact number of
   * reflow-causing writes. The list starts at the bottom (pinnedToBottom true).
   */
  async function mountForStreaming() {
    const startMessage = makeMessage("m-0", "first");
    const messages = [startMessage];
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();
    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    const counter = mountScrollCounter(scroller, 1000);
    return { wrapper, scroller, counter, startMessage };
  }

  /**
   * Simulate the token stream: grow the last message's content one delta at a
   * time by re-setting the messages prop (exactly how the streaming path in
   * AiChatV2.vue drives this component). The starting message is passed in
   * rather than read back via wrapper.props("messages"), whose generic overload
   * infers `never` for string-key prop access.
   */
  async function streamTokens(
    wrapper: ReturnType<typeof mountMessages>,
    start: ChatV2MessageView,
    count: number
  ): Promise<void> {
    let current = start;
    for (let i = 0; i < count; i++) {
      const updated: ChatV2MessageView = {
        ...current,
        content: `${current.content}tok${i} `,
      };
      current = updated;
      await wrapper.setProps({ messages: [updated] });
    }
  }

  it("coalesces many streamed tokens into a single scrollTop write per frame", async () => {
    vi.useFakeTimers();
    try {
      const { wrapper, counter, startMessage } = await mountForStreaming();
      const writesBefore = counter.getWriteCount();

      // Stream 50 tokens without advancing the fake clock — they all land
      // within the same animation frame, so the coalesced scheduler must
      // drop the redundant 49 and keep only ONE pending rAF.
      await streamTokens(wrapper, startMessage, 50);
      // No rAF has fired yet (clock frozen) → zero NEW writes so far.
      expect(counter.getWriteCount()).toBe(writesBefore);

      // Flush the single queued animation frame.
      await vi.advanceTimersByTimeAsync(16);
      // Exactly one write for all 50 tokens — the core reflow win.
      expect(counter.getWriteCount() - writesBefore).toBe(1);

      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule scroll-to-bottom while the user is scrolled up", async () => {
    vi.useFakeTimers();
    try {
      const { wrapper, scroller, counter, startMessage } = await mountForStreaming();
      // User scrolls away from the bottom → pinnedToBottom flips false.
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll"));
      const writesBefore = counter.getWriteCount();

      await streamTokens(wrapper, startMessage, 20);
      // Flush any frame that might (wrongly) have been scheduled.
      await vi.advanceTimersByTimeAsync(16);

      // No writes: we must not fight a user who scrolled up to read history.
      expect(counter.getWriteCount()).toBe(writesBefore);

      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending coalesced scroll on unmount (no late write)", async () => {
    vi.useFakeTimers();
    try {
      const { wrapper, counter, startMessage } = await mountForStreaming();
      const writesBefore = counter.getWriteCount();

      // One token schedules a rAF but does not flush it.
      await streamTokens(wrapper, startMessage, 1);
      expect(counter.getWriteCount()).toBe(writesBefore); // frame not fired yet

      // Unmount BEFORE the queued rAF fires. The onBeforeUnmount hook must
      // cancelAnimationFrame so the callback never runs against a detached
      // scroller.
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(16);
      // Still zero new writes — the pending frame was cancelled, not executed.
      expect(counter.getWriteCount()).toBe(writesBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still pins to the bottom immediately on a non-streaming transition", async () => {
    // Guards against over-throttling: the messages.length watcher (history
    // load, new conversation) uses the immediate path, not the coalesced one,
    // so a fresh conversation shows its first messages without a frame delay.
    const messages = [makeMessage("m-0", "first")];
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();
    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    const counter = mountScrollCounter(scroller, 1000);
    const writesBefore = counter.getWriteCount();

    // Append a NEW message (length changes) — drives the immediate watcher.
    await wrapper.setProps({
      messages: [makeMessage("m-0", "first"), makeMessage("m-1", "second")],
    });
    await wrapper.vm.$nextTick();

    // Immediate path writes synchronously, no rAF needed.
    expect(counter.getWriteCount()).toBeGreaterThan(writesBefore);
    wrapper.unmount();
  });
});
