/**
 * Permission-UI coverage for the file-transfer approval flow.
 *
 * - SkillApprovalCard renders the metadata-only file_transfer preview with
 *   one row per requested file and clamps long paths with ellipsis CSS so a
 *   wide path cannot resize the card.
 * - Approve-once / always-allow / deny emit their typed payloads.
 * - The attach_local_images success card in AiChatV2Message shows names and
 *   dimensions only — never paths or base64.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (happy-dom environment).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
// Raw SFC source so the test can pin the CSS clamp contract. The component
// config stubs `fs` for happy-dom, so a ?raw import is the reliable way to
// read the file.
import cardSource from "@/views/components/aiChat/SkillApprovalCard.vue?raw";
import { createI18n } from "vue-i18n";
import SkillApprovalCard from "@/views/components/aiChat/SkillApprovalCard.vue";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      skills: {
        approval_title: "Permission needed",
        approval_description: "The assistant wants to use a tool.",
        approval_deny: "Deny",
        approval_allow_once: "Allow once",
        approval_always_allow: "Always allow",
      },
      aiChatV2: {
        tool_result_title: "Tool Result",
        imageTool: {
          permissionTitle: "Send images to the AI server?",
          permissionDescription:
            "The following images will be sent to {destination}.",
        },
      },
    },
  },
});

/** File-transfer preview shape produced by buildAttachLocalImagesPermissionPreview. */
const FILE_TRANSFER_PREVIEW = {
  kind: "file_transfer" as const,
  titleKey: "aiChatV2.imageTool.permissionTitle",
  descriptionKey: "aiChatV2.imageTool.permissionDescription",
  items: [
    "photos/lion-original.png",
    "photos/second-reference.jpg",
    "assets/composite-sketch.webp",
  ],
  destinationLabel: "Configured AI Server",
};

function mountCard(preview = FILE_TRANSFER_PREVIEW) {
  return mount(SkillApprovalCard, {
    props: {
      toolName: "attach_local_images",
      permissionCategory: "filesystem",
      permissionPreview: preview,
    },
    global: {
      plugins: [i18n],
      stubs: { VIcon: true, VChip: true, VBtn: true },
    },
  });
}

describe("SkillApprovalCard file-transfer permission preview", () => {
  beforeEach(() => {
    // The grant/deny handlers await window.api.invoke before emitting. Assign
    // the property directly — stubGlobal("window", …) would replace the
    // happy-dom window and break @vue/test-utils event construction.
    (window as unknown as { api: unknown }).api = {
      invoke: vi.fn().mockResolvedValue({ status: true }),
    };
  });

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("renders one metadata-only row per requested file (three rows)", async () => {
    const wrapper = mountCard();
    await flushPromises();

    const rows = wrapper.findAll(".permission-preview-row");
    // title + description + three item rows
    expect(rows.length).toBe(5);
    const itemCodes = wrapper.findAll(".permission-preview-item");
    expect(itemCodes.length).toBe(3);
    expect(itemCodes.map((c) => c.text())).toEqual(FILE_TRANSFER_PREVIEW.items);
    expect(wrapper.find(".permission-preview-title").text()).toBe(
      "Send images to the AI server?"
    );
    expect(wrapper.find(".permission-preview-desc").text()).toContain(
      "Configured AI Server"
    );
  });

  it("clamps long paths with the ellipsis style class so the card never widens", async () => {
    const longPath =
      "photos/2026/summer/release-candidates/final/exported-renders/really-long-directory-name/extended-lion-composite-with-dog-and-background-scene.png";
    const wrapper = mountCard({
      ...FILE_TRANSFER_PREVIEW,
      items: [longPath],
    });
    await flushPromises();

    const item = wrapper.find(".permission-preview-item");
    expect(item.exists()).toBe(true);
    // The clamping class must be applied to the rendered item…
    expect(item.classes()).toContain("permission-preview-item");
    // …and the SFC stylesheet must keep the ellipsis clamp for that class.
    // (SFC styles are not injected into happy-dom, so pin the raw source.)
    const clampRule = (cardSource as string).match(
      /\.permission-preview-item\s*\{[^}]*\}/
    )?.[0];
    expect(clampRule).toBeDefined();
    expect(clampRule).toContain("text-overflow: ellipsis");
    expect(clampRule).toContain("overflow: hidden");
    expect(clampRule).toContain("white-space: nowrap");
  });

  it("emits grant {persistent:false} on Allow once", async () => {
    const wrapper = mountCard();
    await flushPromises();

    await wrapper
      .find('[data-testid="ai-chat-permission-allow-once"]')
      .trigger("click");
    await flushPromises();

    const grants = wrapper.emitted("grant") ?? [];
    expect(grants.length).toBe(1);
    expect(grants[0][0]).toEqual({ persistent: false });
  });

  it("emits grant {persistent:true} on Always allow (non-shell)", async () => {
    const wrapper = mountCard();
    await flushPromises();

    await wrapper
      .find('[data-testid="ai-chat-permission-always-allow"]')
      .trigger("click");
    await flushPromises();

    const grants = wrapper.emitted("grant") ?? [];
    expect(grants.length).toBe(1);
    expect(grants[0][0]).toEqual({ persistent: true });
  });

  it("emits deny on Deny", async () => {
    const wrapper = mountCard();
    await flushPromises();

    await wrapper
      .find('[data-testid="ai-chat-permission-deny"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.emitted("deny")?.length).toBe(1);
  });
});

describe("AiChatV2Message attach_local_images success card", () => {
  it("shows names and dimensions only — no paths, no base64, no data URLs", async () => {
    const message = {
      id: "msg-attach-1",
      conversationId: "c1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      messageType: MessageType.TOOL_RESULT,
      metadata: {
        source: "chat-v2",
        toolCallId: "call-attach-1",
        toolName: "attach_local_images",
        toolResult: {
          success: true,
          attached_count: 2,
          attachments: [
            {
              file_name: "lion-original.png",
              relative_path: "photos/lion-original.png",
              mime_type: "image/png",
              prepared_size_bytes: 2048,
              width: 800,
              height: 600,
            },
            {
              file_name: "second-reference.jpg",
              relative_path: "photos/second-reference.jpg",
              mime_type: "image/jpeg",
              prepared_size_bytes: 4096,
              width: 1024,
              height: 768,
            },
          ],
          summary: "Prepared 2 images for the next AI request.",
        },
        success: true,
      },
    } as unknown as ChatV2MessageView;

    const wrapper = mount(AiChatV2Message, {
      props: { message },
      global: {
        plugins: [i18n],
        stubs: {
          SkillApprovalCard: true,
          AiChatV2StreamStatus: true,
          AiChatV2PlanApprovalCard: true,
          VIcon: true,
          VProgressLinear: true,
        },
      },
    });
    await flushPromises();

    const rows = wrapper.findAll(".v2-message__attachment-row");
    expect(rows.length).toBe(2);
    expect(rows[0].find(".v2-message__attachment-name").text()).toBe(
      "lion-original.png"
    );
    expect(rows[0].find(".v2-message__attachment-meta").text()).toContain(
      "800×600"
    );
    // Metadata-only card: no directory paths, no encoded bytes anywhere.
    const text = wrapper.text();
    expect(text).not.toContain("photos/");
    expect(text).not.toContain("data:image/");
    expect(text).not.toContain("base64");
  });
});
