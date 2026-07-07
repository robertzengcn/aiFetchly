import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2SlashSuggestions from "@/views/components/aiChatV2/AiChatV2SlashSuggestions.vue";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      slashCommands: {
        aria_label: "Slash commands",
        noMatches: "No matching commands",
        sourceBuiltin: "Built-in",
        sourceUser: "User",
        sourceWorkspace: "Workspace",
        sourcePlugin: "Plugin",
      },
    },
  },
});

function makeCommand(
  overrides: Partial<SlashCommandView> = {}
): SlashCommandView {
  return {
    id: "built-in:command:status",
    name: "status",
    description: "Show AiFetchly configuration status.",
    aliases: [],
    source: "built-in",
    sourceLabel: "Built-in",
    argumentHint: undefined,
    enabled: true,
    ...overrides,
  };
}

function mountSuggestions(props: {
  commands?: readonly SlashCommandView[];
  highlightedIndex?: number;
  open?: boolean;
}) {
  return mount(AiChatV2SlashSuggestions, {
    props: {
      commands: props.commands ?? [makeCommand()],
      highlightedIndex: props.highlightedIndex ?? 0,
      open: props.open ?? true,
    },
    global: {
      plugins: [i18n],
      stubs: { VIcon: true },
    },
  });
}

describe("AiChatV2SlashSuggestions", () => {
  it("renders nothing when open is false", () => {
    const wrapper = mountSuggestions({ open: false });

    expect(wrapper.find(".slash-suggestions").exists()).toBe(false);
  });

  it("renders the list with name, description, and source badge when open", () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({
          id: "built-in:command:help",
          name: "help",
          description: "List available commands.",
        }),
        makeCommand({
          id: "built-in:command:status",
          name: "status",
          description: "Show status.",
        }),
      ],
    });

    const items = wrapper.findAll(".slash-suggestions__item");
    expect(items).toHaveLength(2);
    expect(wrapper.text()).toContain("/help");
    expect(wrapper.text()).toContain("/status");
    expect(wrapper.text()).toContain("List available commands.");
    // Built-in badge text renders for both rows.
    expect(wrapper.text()).toContain("Built-in");
  });

  it("emits 'select' with the index when an item is clicked", async () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({ id: "built-in:command:help", name: "help" }),
        makeCommand({ id: "built-in:command:status", name: "status" }),
      ],
      highlightedIndex: -1,
    });

    await wrapper.findAll(".slash-suggestions__item")[1].trigger("click");

    const selectEvents = wrapper.emitted("select");
    expect(selectEvents).toBeDefined();
    expect(selectEvents?.[0]).toEqual([1]);
  });

  it("marks the highlighted row with aria-selected", () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({ id: "built-in:command:help", name: "help" }),
        makeCommand({ id: "built-in:command:status", name: "status" }),
      ],
      highlightedIndex: 1,
    });

    const items = wrapper.findAll(".slash-suggestions__item");
    expect(items[0].attributes("aria-selected")).toBe("false");
    expect(items[1].attributes("aria-selected")).toBe("true");
    expect(items[1].classes()).toContain(
      "slash-suggestions__item--highlighted"
    );
  });

  it("emits 'highlight' with the index on mouseenter", async () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({ id: "built-in:command:help", name: "help" }),
        makeCommand({ id: "built-in:command:status", name: "status" }),
      ],
      highlightedIndex: 0,
    });

    await wrapper.findAll(".slash-suggestions__item")[1].trigger("mouseenter");

    const highlightEvents = wrapper.emitted("highlight");
    expect(highlightEvents).toBeDefined();
    expect(highlightEvents?.[0]).toEqual([1]);
  });

  it("renders a disabled row with aria-disabled when enabled is false", () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({
          id: "workspace:1:command:custom",
          name: "custom",
          source: "workspace",
          sourceLabel: "Workspace",
          enabled: false,
          disabledReason: "Workspace not trusted",
        }),
      ],
      highlightedIndex: -1,
    });

    const item = wrapper.find(".slash-suggestions__item");
    expect(item.attributes("aria-disabled")).toBe("true");
    expect(item.classes()).toContain("slash-suggestions__item--disabled");
    expect(wrapper.text()).toContain("Workspace not trusted");
    // Workspace source badge label.
    expect(wrapper.text()).toContain("Workspace");
  });

  it("renders the argumentHint inline in the name row when present (D-04)", () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({
          id: "user:command:review",
          name: "review",
          source: "user",
          sourceLabel: "User",
          argumentHint: "<path>",
          description: "Review code",
        }),
      ],
    });

    const row = wrapper.find(".slash-suggestions__row");
    // The hint appears in the SAME row as /review (D-04 inline)...
    expect(row.text()).toContain("/review");
    expect(row.text()).toContain("<path>");
    // ...and is no longer in the meta row (it moved out of meta).
    const meta = wrapper.find(".slash-suggestions__meta");
    expect(meta.text()).not.toContain("<path>");
  });

  it("renders NO argumentHint placeholder when the hint is absent (D-04)", () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({
          id: "built-in:command:status",
          name: "status",
          argumentHint: undefined,
        }),
      ],
    });

    expect(wrapper.find(".slash-suggestions__arg-hint").exists()).toBe(false);
    const row = wrapper.find(".slash-suggestions__row");
    expect(row.text()).toContain("/status");
  });

  it("treats an empty-string argumentHint the same as absent (no placeholder)", () => {
    const wrapper = mountSuggestions({
      commands: [
        makeCommand({
          id: "built-in:command:status",
          name: "status",
          argumentHint: "",
        }),
      ],
    });

    expect(wrapper.find(".slash-suggestions__arg-hint").exists()).toBe(false);
  });
});
