import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import EditSearchTaskDialog from "@/views/pages/search/components/EditSearchTaskDialog.vue";
import {
  type TaskDetailsForEdit,
  SearchTaskStatusValue,
} from "@/entityTypes/searchControlType";

/**
 * Component tests for the search-task edit dialog: loads task details into
 * the form when opened, runs the keyword/textarea binding, submits the edit
 * through updateSearchTask (emitting saved/error), and cancels cleanly.
 * Also covers the typed required-validation rules on the select/textarea
 * (the TS7006 fix: rule params are explicitly `string`).
 */

enableAutoUnmount(afterEach);

const getDetailsMock = vi.fn(async (_taskId: number) => taskDetailsFixture());
const updateMock = vi.fn(async (_taskId: number, _updates: unknown) => true);
const receiveUpdateEventMock = vi.fn();

vi.mock("@/views/api/search", () => ({
  getSearchTaskDetails: (taskId: number): Promise<TaskDetailsForEdit> =>
    getDetailsMock(taskId),
  updateSearchTask: (taskId: number, updates: unknown): Promise<boolean> =>
    updateMock(taskId, updates),
  receiveSearchTaskUpdateEvent: (cb: (data: unknown) => void): void => {
    receiveUpdateEventMock(cb);
  },
}));

function taskDetailsFixture(): TaskDetailsForEdit {
  return {
    id: 42,
    engine: 1,
    engineName: "Google",
    keywords: ["ai", "marketing"],
    num_pages: 3,
    concurrency: 2,
    notShowBrowser: false,
    localBrowser: "chrome",
    proxys: [],
    accounts: [1, 2],
    status: SearchTaskStatusValue.NotStart,
    record_time: "2026-01-01T00:00:00.000Z",
  };
}

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: {
        edit_task: "Edit Task",
        search_enginer_name: "Search Engine",
        num_pages: "Pages",
        concurrency: "Concurrency",
        not_show_browser: "Hide Browser",
        local_browser: "Local Browser",
        keyword: "Keywords",
        keywords_placeholder: "One per line",
        proxies: "Proxies",
        proxy_host: "Host",
        proxy_port: "Port",
        proxy_user: "User",
        proxy_pass: "Password",
        add_proxy: "Add proxy",
        select_accounts: "Accounts",
        accounts: "Accounts",
      },
      validation: { required: "This field is required" },
      common: { cancel: "Cancel", save: "Save" },
    },
  },
});

// Vuetify is not registered in the component-test config; stub the rendered
// components. VDialog renders its slot only while open, mirroring Vuetify.
const VDialog = defineComponent({
  name: "VDialog",
  props: { modelValue: { type: Boolean, default: false } },
  template: `<div v-if="modelValue" data-testid="v-dialog"><slot /></div>`,
});
const passThrough = (name: string): ReturnType<typeof defineComponent> =>
  defineComponent({ name, template: `<div><slot /></div>` });
const VCard = passThrough("VCard");
const VCardTitle = passThrough("VCardTitle");
const VCardText = passThrough("VCardText");
const VCardActions = passThrough("VCardActions");
const VRow = passThrough("VRow");
const VCol = passThrough("VCol");
const VSpacer = passThrough("VSpacer");
const VExpansionPanels = passThrough("VExpansionPanels");
const VExpansionPanel = passThrough("VExpansionPanel");
const VExpansionPanelTitle = passThrough("VExpansionPanelTitle");
const VExpansionPanelText = passThrough("VExpansionPanelText");

const VForm = defineComponent({
  name: "VForm",
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  mounted(): void {
    // Vuetify sets valid=true once the form mounts without errors.
    this.$emit("update:modelValue", true);
  },
  template: `<form><slot /></form>`,
});

const VSelect = defineComponent({
  name: "VSelect",
  props: {
    modelValue: { type: [String, Number, Array], default: "" },
    items: { type: Array, default: () => [] },
    label: { type: String, default: "" },
    rules: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  template: `<select data-testid="v-select"><slot /></select>`,
});

const VTextField = defineComponent({
  name: "VTextField",
  props: {
    modelValue: { type: [String, Number], default: "" },
    label: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template: `<input data-testid="v-text-field" />`,
});

const VTextarea = defineComponent({
  name: "VTextarea",
  props: {
    modelValue: { type: String, default: "" },
    label: { type: String, default: "" },
    rules: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue", "input"],
  template: `<textarea data-testid="v-textarea"><slot /></textarea>`,
});

const VChipGroup = passThrough("VChipGroup");
const VChip = defineComponent({
  name: "VChip",
  emits: ["click:close"],
  template: `<span data-testid="keyword-chip" @click="$emit('click:close')"><slot /></span>`,
});

const VBtn = defineComponent({
  name: "VBtn",
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  emits: ["click"],
  template: `<button :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
});

const VSwitch = defineComponent({
  name: "VSwitch",
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  template: `<input type="checkbox" data-testid="v-switch" />`,
});

/**
 * Mount the dialog closed, then open it via setProps — the component loads
 * task details from a `watch(dialog)` that only fires on the false->true
 * transition (real usage), not on initial mount.
 */
async function mountAndOpen(taskId: number | undefined) {
  const wrapper = mount(EditSearchTaskDialog, {
    props: { modelValue: false, taskId },
    global: {
      plugins: [i18n],
      components: {
        VDialog,
        VCard,
        VCardTitle,
        VCardText,
        VCardActions,
        VRow,
        VCol,
        VSpacer,
        VForm,
        VSelect,
        VTextField,
        VTextarea,
        VChipGroup,
        VChip,
        VBtn,
        VSwitch,
        VExpansionPanels,
        VExpansionPanel,
        VExpansionPanelTitle,
        VExpansionPanelText,
      },
    },
  });
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
}

describe("EditSearchTaskDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads task details into the form when opened with a taskId", async () => {
    const wrapper = await mountAndOpen(42);
    await flushPromises();

    expect(getDetailsMock).toHaveBeenCalledWith(42);
    // engine comes back numeric and is rendered as its string form; keywords
    // are joined back into the textarea.
    const select = wrapper.findComponent(VSelect);
    expect(select.props("modelValue")).toBe("1");
    const textarea = wrapper.findComponent(VTextarea);
    expect(textarea.props("modelValue")).toBe("ai\nmarketing");
  });

  it("does not fetch details when opened without a taskId", async () => {
    await mountAndOpen(undefined);
    await flushPromises();
    expect(getDetailsMock).not.toHaveBeenCalled();
  });

  it("required rules accept a value and reject an empty one (typed rule params)", async () => {
    const wrapper = await mountAndOpen(42);
    await flushPromises();

    const textareaRules = wrapper.findComponent(VTextarea).props("rules") as Array<
      (v: string) => boolean | string
    >;
    expect(textareaRules.length).toBeGreaterThan(0);
    expect(textareaRules[0]("ai")).toBe(true);
    expect(textareaRules[0]("")).toBe("This field is required");

    const selectRules = wrapper.findComponent(VSelect).props("rules") as Array<
      (v: string) => boolean | string
    >;
    expect(selectRules.length).toBeGreaterThan(0);
    expect(selectRules[0]("google")).toBe(true);
    expect(selectRules[0]("")).toBe("This field is required");
  });

  it("save submits the parsed keywords and emits saved + close", async () => {
    const wrapper = await mountAndOpen(42);
    await flushPromises();
    updateMock.mockResolvedValueOnce(true);

    const buttons = wrapper.findAll("button");
    const saveButton = buttons.find(
      (b) => b.text().trim() === "Save"
    ) as Awaited<ReturnType<typeof wrapper.findAll>>[number];
    await saveButton.trigger("click");
    await flushPromises();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ engine: "1", keywords: ["ai", "marketing"] })
    );
    expect(wrapper.emitted("saved")).toEqual([[42]]);
    expect(wrapper.emitted("update:modelValue")).toContainEqual([false]);
  });

  it("emits error when the update request fails", async () => {
    const wrapper = await mountAndOpen(42);
    await flushPromises();
    updateMock.mockRejectedValueOnce(new Error("boom"));

    const buttons = wrapper.findAll("button");
    const saveButton = buttons.find(
      (b) => b.text().trim() === "Save"
    ) as Awaited<ReturnType<typeof wrapper.findAll>>[number];
    await saveButton.trigger("click");
    await flushPromises();

    expect(wrapper.emitted("error")).toEqual([["boom"]]);
    // The dialog stays open so the user can retry.
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("cancel closes without calling the update API", async () => {
    const wrapper = await mountAndOpen(42);
    await flushPromises();

    const buttons = wrapper.findAll("button");
    const cancelButton = buttons.find(
      (b) => b.text().trim() === "Cancel"
    ) as Awaited<ReturnType<typeof wrapper.findAll>>[number];
    await cancelButton.trigger("click");

    expect(updateMock).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:modelValue")).toContainEqual([false]);
  });

  it("removing a keyword chip updates keywords and the textarea", async () => {
    const wrapper = await mountAndOpen(42);
    await flushPromises();

    const chips = wrapper.findAllComponents(VChip);
    expect(chips).toHaveLength(2);
    await chips[0].trigger("click");
    await flushPromises();

    const textarea = wrapper.findComponent(VTextarea);
    expect(textarea.props("modelValue")).toBe("marketing");
    const remaining = wrapper.findAllComponents(VChip);
    expect(remaining).toHaveLength(1);
  });
});
