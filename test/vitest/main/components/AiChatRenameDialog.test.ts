import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatRenameDialog from "@/views/components/aiChatWorkspace/AiChatRenameDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        renameDialog: {
          title: "Rename chat",
          label: "Chat name",
          save: "Save",
          cancel: "Cancel",
          limitHint: "Max 200 characters",
          errorEmpty: "Enter a name for this chat",
          errorTooLong: "Names must be 200 characters or fewer",
          errorInvalid: "That name contains unsupported characters",
          errorSaveFailed: "Couldn't rename this chat. Please try again.",
          errorUnavailable: "This chat is no longer available",
          saving: "Saving…",
          renameAction: "Rename chat",
          menuButtonLabel: "Conversation actions",
        },
      },
    },
  },
});

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(AiChatRenameDialog, {
    props: {
      modelValue: true,
      initialTitle: "Sydney Dentists",
      saving: false,
      error: null,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        "v-dialog": {
          template:
            '<div v-if="modelValue"><slot /></div>',
          props: ["modelValue"],
        },
        "v-card": { template: "<div><slot /></div>" },
        "v-card-title": { template: "<div><slot /></div>" },
        "v-card-text": { template: "<div><slot /></div>" },
        "v-card-actions": { template: "<div><slot /></div>" },
        // Root <input> so fallthrough attrs (data-testid, aria, keydown
        // listeners) land on the same element the tests query.
        "v-text-field": {
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ["modelValue", "errorMessages", "label", "hint", "counter", "maxlength"],
          emits: ["update:modelValue"],
        },
        "v-btn": {
          template:
            '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ["disabled", "loading"],
          emits: ["click"],
        },
        "v-spacer": { template: "<span />" },
        "v-icon": { template: "<i />" },
      },
    },
  });
}

function findSave(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-testid="rename-dialog-save"]');
}

describe("AiChatRenameDialog", () => {
  it("B22: with a real-shaped VTextField wrapper, focus AND selection land on the inner input", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(AiChatRenameDialog, {
      attachTo: host,
      props: {
        modelValue: true,
        initialTitle: "Sydney Dentists",
        saving: false,
        error: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          // B22: real VTextField shape — a WRAPPER div around the input.
          "v-dialog": {
            template: '<div v-if="modelValue"><slot /></div>',
            props: ["modelValue"],
          },
          "v-card": { template: "<div><slot /></div>" },
          "v-card-title": { template: "<div><slot /></div>" },
          "v-card-text": { template: "<div><slot /></div>" },
          "v-card-actions": { template: "<div><slot /></div>" },
          "v-text-field": {
            template:
              '<div class="v-text-field__wrapper"><input ref="inner" :value="modelValue" data-testid="rename-dialog-input" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
            props: ["modelValue", "errorMessages", "label", "hint", "counter"],
            emits: ["update:modelValue"],
          },
          "v-btn": {
            template:
              '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
            props: ["disabled", "loading"],
            emits: ["click"],
          },
          "v-spacer": { template: "<span />" },
          "v-icon": { template: "<i />" },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const inner = wrapper.find('input[data-testid="rename-dialog-input"]')
      .element as HTMLInputElement;
    expect(document.activeElement).toBe(inner);
    // Selection covers the prefilled name (select-on-open).
    expect(inner.selectionStart).toBe(0);
    expect(inner.selectionEnd).toBe("Sydney Dentists".length);
    wrapper.unmount();
    host.remove();
  });

  it("prefills the input with the current title when opened", async () => {
    const wrapper = mountDialog();
    const input = wrapper.find('[data-testid="rename-dialog-input"]');
    expect((input.element as HTMLInputElement).value).toBe("Sydney Dentists");
  });

  it("saves a valid name and emits the normalized title", async () => {
    const wrapper = mountDialog();
    await wrapper
      .find('[data-testid="rename-dialog-input"]')
      .setValue("  Sydney Dentists — Q4  ");
    await findSave(wrapper).trigger("click");
    expect(wrapper.emitted("save")).toEqual([["Sydney Dentists — Q4"]]);
  });

  it("rejects an empty or whitespace-only name with an inline error", async () => {
    const wrapper = mountDialog();
    await wrapper.find('[data-testid="rename-dialog-input"]').setValue("   ");
    await findSave(wrapper).trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.find('[data-testid="rename-dialog-error"]').text()).toContain(
      "Enter a name"
    );
  });

  it("rejects a name over 200 UTF-16 units", async () => {
    const wrapper = mountDialog();
    await wrapper.find('[data-testid="rename-dialog-input"]').setValue("a".repeat(201));
    await findSave(wrapper).trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.find('[data-testid="rename-dialog-error"]').text()).toContain(
      "200"
    );
  });

  it("Enter saves only when no IME composition is active (AC-14)", async () => {
    const wrapper = mountDialog();
    const input = wrapper.find('[data-testid="rename-dialog-input"]');
    await input.setValue("Renamed");
    // Composition active (Chinese/Japanese IME): Enter must NOT save.
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.emitted("save")).toBeUndefined();
    await input.trigger("keydown", { key: "Enter", isComposing: false });
    expect(wrapper.emitted("save")).toEqual([["Renamed"]]);
  });

  it("cancel emits cancel and closes without saving", async () => {
    const wrapper = mountDialog();
    await wrapper.find('[data-testid="rename-dialog-cancel"]').trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("disables Save while saving to prevent duplicate submission", async () => {
    const wrapper = mountDialog({ saving: true });
    expect(
      (findSave(wrapper).element as HTMLButtonElement).disabled
    ).toBe(true);
    await findSave(wrapper).trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("shows the unavailable error and preserves the typed draft on save failure", async () => {
    const wrapper = mountDialog({ error: "unavailable" });
    await wrapper.find('[data-testid="rename-dialog-input"]').setValue("My Draft Name");
    expect(wrapper.find('[data-testid="rename-dialog-error"]').text()).toContain(
      "no longer available"
    );
    expect(
      (wrapper.find('[data-testid="rename-dialog-input"]').element as HTMLInputElement).value
    ).toBe("My Draft Name");
  });

  it("shows the generic save-failed error for persist failures", async () => {
    const wrapper = mountDialog({ error: "save_failed" });
    expect(wrapper.find('[data-testid="rename-dialog-error"]').text()).toContain(
      "Couldn't rename"
    );
  });

  it("supports emoji names within the UTF-16 ceiling", async () => {
    const wrapper = mountDialog();
    await wrapper
      .find('[data-testid="rename-dialog-input"]')
      .setValue("😀".repeat(100));
    await findSave(wrapper).trigger("click");
    expect(wrapper.emitted("save")?.[0]).toEqual(["😀".repeat(100)]);
  });
});
