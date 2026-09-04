import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import OutboundEmailRecipientDraft from "@/views/components/outboundEmail/OutboundEmailRecipientDraft.vue";
import type { OutboundEmailDraftView } from "@/views/api/outboundEmailDelivery";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      outboundEmail: {
        subject: "Subject",
        body: "Body",
        sender: "Sender",
        recipient: "Recipient",
        edit: "Edit",
        save: "Save",
        cancel: "Cancel",
        approval_invalidated:
          "Edits invalidate prior approval. Re-approve before sending.",
      },
    },
  },
});

function makeDraft(
  overrides: Partial<OutboundEmailDraftView> = {}
): OutboundEmailDraftView {
  return {
    id: 10,
    recipientAddress: "alice@example.com",
    recipientDisplayName: "Alice",
    status: "draft",
    revisionNumber: 1,
    subject: "Hello Alice",
    bodyText: "Hi Alice",
    bodyHtml: null,
    emailServiceId: 1,
    senderAddress: "sender@example.com",
    ...overrides,
  };
}

function mountDraft(
  props: {
    draft?: Partial<OutboundEmailDraftView>;
    editMode?: boolean;
  } = {}
) {
  return mount(OutboundEmailRecipientDraft, {
    global: {
      plugins: [i18n],
      stubs: {
        VTextField: {
          props: ["modelValue", "label"],
          emits: ["update:modelValue"],
          template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
        VTextarea: {
          props: ["modelValue", "label"],
          emits: ["update:modelValue"],
          template: `<textarea :value="modelValue" @input="$emit('update:modelValue', $event.target.value)"></textarea>`,
        },
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VAlert: { template: "<div><slot /></div>" },
      },
    },
    props: {
      draft: makeDraft(props.draft),
      editMode: props.editMode ?? false,
    },
  });
}

describe("OutboundEmailRecipientDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the recipient display name + address and subject preview", () => {
    const wrapper = mountDraft();
    expect(wrapper.text()).toContain("Alice");
    expect(wrapper.text()).toContain("alice@example.com");
    expect(wrapper.text()).toContain("Hello Alice");
  });

  it("shows the edit button and emits edit-requested when not in edit mode", async () => {
    const wrapper = mountDraft();
    await wrapper.find('[data-testid="outbound-draft-edit"]').trigger("click");
    expect(wrapper.emitted("edit-requested")).toBeTruthy();
  });

  it("emits save with the edited subject and body in edit mode", async () => {
    const wrapper = mountDraft({ editMode: true });
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("Edited Subject");
    const textareas = wrapper.findAll("textarea");
    await textareas[0].setValue("Edited body");
    await wrapper.find('[data-testid="outbound-draft-save"]').trigger("click");
    const payload = wrapper.emitted("save")?.[0]?.[0] as {
      subject: string;
      bodyText: string;
    };
    expect(payload.subject).toBe("Edited Subject");
    expect(payload.bodyText).toBe("Edited body");
  });

  it("emits cancel when the cancel button is pressed in edit mode", async () => {
    const wrapper = mountDraft({ editMode: true });
    await wrapper
      .find('[data-testid="outbound-draft-cancel"]')
      .trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("shows the approval-invalidated warning when edited is true", () => {
    const wrapper = mountDraft({ editMode: true });
    expect(wrapper.text()).toMatch(/invalidate prior approval/i);
  });
});
