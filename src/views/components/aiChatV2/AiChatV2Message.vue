<template>
  <!-- Plan approval card renders inline (no bubble wrapper) -->
  <div v-if="isPlanCard" class="v2-message v2-message--plan">
    <AiChatV2PlanApprovalCard
      :plan-state="message.metadata!.planStateView!"
      :disabled="disabled"
      @approve="emit('approve-plan')"
      @reject="(fb) => emit('reject-plan', fb)"
      @request-changes="(fb) => emit('request-plan-changes', fb)"
    />
  </div>
  <div v-else class="v2-message" :class="`v2-message--${message.role}`">
    <div class="v2-message__bubble">
      <div class="v2-message__meta">
        <span class="v2-message__role">{{ roleLabel }}</span>
        <span v-if="messageTime" class="v2-message__time">
          {{ messageTime }}
        </span>
      </div>
      <template v-if="message.messageType === MessageType.TOOL_CALL">
        <div class="v2-message__tool-header">
          <v-icon size="small" color="purple" class="mr-1">mdi-toolbox</v-icon>
          <strong>{{ t("aiChatV2.tool_call_title") || "Tool Call" }}</strong>
        </div>
        <div v-if="message.metadata?.toolName" class="v2-message__tool-field">
          <strong>{{ t("aiChatV2.tool_name") || "Tool" }}:</strong>
          <span>{{ message.metadata.toolName }}</span>
          <span
            v-if="toolProgress"
            class="tool-progress-badge"
            style="margin-left: 8px; display: inline-flex; align-items: center; gap: 4px;"
          >
            <v-icon size="small" class="mdi-spin">mdi-loading</v-icon>
            <span class="text-caption">{{
              toolProgress.message ||
              t("aiChatV2.tool_running") ||
              "Running..."
            }}</span>
            <span
              v-if="
                typeof toolProgress.partialCount === 'number' &&
                typeof toolProgress.expectedCount === 'number'
              "
              class="text-caption"
            >
              ({{ toolProgress.partialCount }}/{{ toolProgress.expectedCount }})
            </span>
          </span>
        </div>
        <v-progress-linear
          v-if="toolProgress && typeof toolProgress.progress === 'number'"
          :model-value="Math.round(toolProgress.progress * 100)"
          height="4"
          style="margin-top: 4px;"
        />
        <details v-if="message.metadata?.toolArguments" class="v2-message__details">
          <summary>{{ t("aiChatV2.tool_arguments") || "Arguments" }}</summary>
          <pre>{{ JSON.stringify(message.metadata.toolArguments, null, 2) }}</pre>
        </details>
      </template>
      <template v-else-if="message.messageType === MessageType.TOOL_RESULT">
        <SkillApprovalCard
          v-if="needsPermissionPrompt"
          :tool-name="String(message.metadata?.toolName || '')"
          :permission-category="String(toolResult.permissionCategory || '')"
          :shell-preview="shellPreview"
          :permission-preview="permissionPreview"
          :workspace-root="workspaceRoot"
          @grant="(payload) => emit('grant-permission', message, payload)"
          @deny="emit('deny-permission', message)"
        />
        <template v-else>
          <div class="v2-message__tool-header">
            <v-icon
              size="small"
              :color="executionPending ? 'purple' : message.metadata?.success === false ? 'error' : 'success'"
              class="mr-1"
              :class="{ 'mdi-spin': executionPending }"
            >
              {{ executionPending ? 'mdi-loading' : message.metadata?.success === false ? 'mdi-alert-circle' : 'mdi-check-circle' }}
            </v-icon>
            <strong :class="{ 'v2-message__tool-running': executionPending }">
              {{ executionPending ? t("aiChatV2.tool_running") || "Running..." : t("aiChatV2.tool_result_title") || "Tool Result" }}
            </strong>
          </div>
          <AiArtifactCard
            v-if="message.metadata?.artifact"
            :artifact="message.metadata.artifact"
            :disabled="disabled"
            @open="(id: string) => emit('open-artifact', id)"
            @copy-html="(id: string) => emit('copy-artifact-html', id)"
          />
          <div v-if="message.metadata?.toolName" class="v2-message__tool-field">
            <strong>{{ t("aiChatV2.tool_name") || "Tool" }}:</strong>
            <span>{{ message.metadata.toolName }}</span>
          </div>
          <div
            v-if="message.metadata?.error || attachLocalImagesErrorLabel"
            class="v2-message__tool-error"
          >
            {{ attachLocalImagesErrorLabel || message.metadata?.error }}
          </div>
          <div v-if="message.metadata?.summary" class="v2-message__content">
            {{ message.metadata.summary }}
          </div>
          <div
            v-if="attachLocalImagesAttachments.length > 0"
            class="v2-message__attachments"
          >
            <div
              v-for="(att, i) in attachLocalImagesAttachments"
              :key="i"
              class="v2-message__attachment-row"
            >
              <v-icon size="x-small" start>mdi-file-image</v-icon>
              <span class="v2-message__attachment-name">{{ att.file_name }}</span>
              <span class="v2-message__attachment-meta">
                {{ att.width }}×{{ att.height }} · {{ att.mime_type }} ·
                {{ formatBytes(att.prepared_size_bytes) }}
              </span>
            </div>
          </div>
          <details v-if="message.content" class="v2-message__details">
            <summary>{{ t("aiChatV2.tool_result_details") || "Details" }}</summary>
            <pre>{{ message.content }}</pre>
          </details>
        </template>
      </template>
      <template v-else>
        <div v-if="message.content" class="v2-message__content">
          {{ message.content }}
        </div>
        <details
          v-if="hasReasoning"
          class="v2-message__reasoning"
          :open="hasReasoning"
        >
          <summary>
            <v-icon size="x-small">mdi-brain</v-icon>
            {{ t("aiChatV2.reasoning_title") || "Reasoning" }}
          </summary>
          <div class="v2-message__reasoning-content">{{ reasoningText }}</div>
        </details>
        <div v-if="generatedImages.length > 0" class="v2-message__images">
          <template v-for="image in generatedImages" :key="image.key">
            <a
              v-if="image.externalHref"
              :href="image.externalHref"
              class="v2-message__image-link"
              target="_blank"
              rel="noreferrer"
              :title="t('aiChatV2.open_generated_image') || 'Open generated image'"
            >
              <img
                class="v2-message__image"
                :src="image.src"
                :alt="t('aiChatV2.generated_image_alt') || 'AI generated image'"
                loading="lazy"
              />
            </a>
            <button
              v-else
              type="button"
              class="v2-message__image-link v2-message__image-button"
              :disabled="!image.localPath"
              :title="t('aiChatV2.open_generated_image') || 'Open generated image'"
              @click="openGeneratedImageFile(image)"
            >
              <img
                class="v2-message__image"
                :src="image.src"
                :alt="t('aiChatV2.generated_image_alt') || 'AI generated image'"
                loading="lazy"
              />
            </button>
          </template>
        </div>
        <!-- User-sent attachments: render inline so the user sees what they
             attached, scrolling with the message history. -->
        <div
          v-if="imageAttachments.length > 0"
          class="v2-message__attachments v2-message__attachments--images"
        >
          <div
            v-for="att in imageAttachments"
            :key="att.key"
            class="v2-message__image-link"
            :title="t('aiChatV2.attachments.image_alt', { name: att.fileName }) || att.fileName"
          >
            <img
              class="v2-message__attachment-image"
              :src="att.previewDataUrl"
              :alt="t('aiChatV2.attachments.image_alt', { name: att.fileName }) || att.fileName"
              loading="lazy"
            />
          </div>
        </div>
        <div
          v-if="fileAttachments.length > 0"
          class="v2-message__attachments v2-message__attachments--docs"
        >
          <v-chip
            v-for="att in fileAttachments"
            :key="att.key"
            size="small"
            variant="tonal"
            class="v2-message__attachment-chip"
          >
            <v-icon start size="x-small">mdi-file-document-outline</v-icon>
            {{ att.fileName }}
          </v-chip>
        </div>
      </template>
      <AiChatV2StreamStatus
        v-if="message.role === 'assistant' && status !== 'idle'"
        :status="status"
        :error-message="errorMessage"
      />
      <div
        v-if="message.role === 'user' && mentionChips.length > 0"
        class="v2-message__mentions"
      >
        <span
          v-for="(chip, index) in mentionChips"
          :key="`${chip.variant}-${index}`"
          class="v2-mention-chip"
          :class="{ 'v2-mention-chip--warning': chip.variant === 'warning' }"
        >
          <v-icon size="x-small">{{ chip.icon }}</v-icon>
          <span v-if="chip.label" class="v2-mention-chip__label">{{
            chip.label
          }}</span>
          <span
            v-if="chip.reason"
            class="v2-mention-chip__reason"
          >
            {{ chip.reason }}
          </span>
        </span>
      </div>

      <div
        v-if="message.role === 'user' && pastedChips.length > 0"
        class="v2-message__mentions"
      >
        <span
          v-for="(chip, index) in pastedChips"
          :key="`${chip.id}-${chip.kind}-${index}`"
          class="v2-mention-chip"
        >
          <v-icon size="x-small">{{ chip.icon }}</v-icon>
          <span v-if="chip.label" class="v2-mention-chip__label">{{
            chip.label
          }}</span>

          <details
            v-if="chip.hasPreview"
            class="v2-paste-details"
            @toggle="
              (e) =>
                onPasteDetailsToggle(
                  chip,
                  (e.target as HTMLDetailsElement).open
                )
            "
          >
            <summary>
              {{
                t("aiChatV2.pastedText.view_content") ||
                "View pasted content"
              }}
            </summary>
            <pre v-if="chip.inlineContent">{{ chip.inlineContent }}</pre>
            <pre
              v-else-if="
                chip.contentHash && pastePreviewContent(chip.contentHash)
              "
            >
              {{ pastePreviewContent(chip.contentHash) }}
            </pre>
            <div v-else>
              {{
                t("aiChatV2.pastedText.loading") || "Loading pasted content..."
              }}
            </div>
          </details>
        </span>
      </div>
      <div v-if="isReportableAssistant" class="v2-message__report">
        <AIContentReportButton
          :descriptor="reportDescriptor!"
          :reported="reportSubmitted"
          @report="reportDialogOpen = true"
        />
        <AIContentReportDialog
          v-model="reportDialogOpen"
          :descriptor="reportDescriptor"
          @submitted="onReportSubmitted"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ChatV2AttachmentMetadata,
  ChatV2GeneratedImage,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";
import type { ChatV2AtMentionMetadata } from "@/entityTypes/aiChatAtMentionTypes";
import type { ChatV2PastedBlockMetadata } from "@/entityTypes/pastedTextTypes";
import { MessageType } from "@/entityTypes/commonType";
import SkillApprovalCard from "@/views/components/aiChat/SkillApprovalCard.vue";
import AiChatV2StreamStatus from "./AiChatV2StreamStatus.vue";
import AiChatV2PlanApprovalCard from "./AiChatV2PlanApprovalCard.vue";
import AiArtifactCard from "@/views/components/aiArtifacts/AiArtifactCard.vue";
import AIContentReportButton from "@/views/components/aiContentReport/AIContentReportButton.vue";
import AIContentReportDialog from "@/views/components/aiContentReport/AIContentReportDialog.vue";
import { buildChatV2Descriptor } from "@/views/components/aiContentReport/reportableOutput";
import { AI_FILE_OPEN } from "@/config/channellist";
import { readPasteCache } from "@/views/api/aiChatV2";
import { windowInvoke } from "@/views/utils/apirequest";

type Status = "idle" | "streaming" | "cancelled" | "error";
type ShellPreview = {
  command: string;
  cwd?: string;
  shell: string;
  timeout_ms: number;
};

const GENERATED_IMAGE_PROTOCOL = "aifetchly-generated-image:";

const props = defineProps<{
  message: ChatV2MessageView;
  status?: Status;
  errorMessage?: string;
  disabled?: boolean;
  workspaceRoot?: string;
  /** Global "Show reasoning" preference — gates whether the panel renders. */
  showReasoning?: boolean;
}>();
const emit = defineEmits<{
  (
    e: "grant-permission",
    message: ChatV2MessageView,
    payload: { persistent: boolean }
  ): void;
  (e: "deny-permission", message: ChatV2MessageView): void;
  (e: "approve-plan"): void;
  (e: "reject-plan", feedback: string): void;
  (e: "request-plan-changes", feedback: string): void;
  (e: "open-artifact", artifactId: string): void;
  (e: "copy-artifact-html", artifactId: string): void;
}>();
const { t, te } = useI18n();

const isPlanCard = computed(
  () => props.message.metadata?.planStateView !== undefined
);

// Report AI output (PRD §8.1). Only completed assistant text/image messages
// are reportable — not tool calls, tool results, user/system messages,
// streaming, errors, or empty placeholders (PRD FR-1.2).
const isReportableAssistant = computed(
  () =>
    props.message.role === "assistant" &&
    props.message.messageType !== MessageType.TOOL_CALL &&
    props.message.messageType !== MessageType.TOOL_RESULT &&
    status.value === "idle"
);
const reportDescriptor = computed(() =>
  isReportableAssistant.value ? buildChatV2Descriptor(props.message) : null
);
const reportDialogOpen = ref(false);
const reportSubmitted = ref(false);

const roleLabel = computed(() => {
  if (props.message.role === "user") {
    return te("common.user") ? t("common.user") : "You";
  }
  if (props.message.role === "assistant") return "AI";
  return props.message.role;
});

const status = computed<Status>(() => props.status ?? "idle");
const disabled = computed(() => props.disabled ?? false);

const messageTime = computed(() => {
  const parsed = Date.parse(props.message.timestamp);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleString();
});

interface RenderableGeneratedImage {
  key: string;
  src: string;
  externalHref?: string;
  localPath?: string;
}

const generatedImages = computed<RenderableGeneratedImage[]>(() => {
  return (props.message.metadata?.generatedImages ?? [])
    .map((image, index) => {
      const src = resolveGeneratedImageSource(image);
      return src
        ? {
            key: `${src}-${index}`,
            src,
            ...(isExternalImageUrl(src) ? { externalHref: src } : {}),
            ...(image.local_path ? { localPath: image.local_path } : {}),
          }
        : null;
    })
    .filter((image): image is RenderableGeneratedImage => image !== null);
});

interface RenderableAttachment {
  key: string;
  fileName: string;
  previewDataUrl?: string;
}

/**
 * Type guard for a user attachment that is safe to render as an inline
 * `<img src>`. Requires `kind === "image"` AND a `data:image/...` preview.
 * The scheme check is the last line of defense: `previewDataUrl` is persisted
 * metadata trusted by the renderer, so a non-image `data:` URL (e.g.
 * `data:text/html`) must never reach an `<img src>` / clickable surface — it
 * falls through to the chip rendering instead.
 */
function isRenderableImageAttachment(
  att: ChatV2AttachmentMetadata
): att is ChatV2AttachmentMetadata & { previewDataUrl: string } {
  return (
    att.kind === "image" &&
    typeof att.previewDataUrl === "string" &&
    att.previewDataUrl.startsWith("data:image/")
  );
}

/**
 * User-sent image attachments with an inline preview. Only user messages
 * carry `metadata.attachments`; rendering the preview here lets the user see
 * exactly which image they sent, scrolling with the message history.
 */
const imageAttachments = computed<RenderableAttachment[]>(() => {
  if (props.message.role !== "user") return [];
  return (props.message.metadata?.attachments ?? [])
    .filter(isRenderableImageAttachment)
    .map((att, index) => ({
      key: `${att.fileName}-${index}`,
      fileName: att.fileName,
      previewDataUrl: att.previewDataUrl,
    }));
});

/**
 * Non-image attachments (documents) and any image whose preview is missing or
 * not a safe `data:image/` URL. Rendered as file chips so the user still sees
 * what they attached — the exact complement of {@link imageAttachments}.
 */
const fileAttachments = computed<RenderableAttachment[]>(() => {
  if (props.message.role !== "user") return [];
  return (props.message.metadata?.attachments ?? [])
    .filter((att) => !isRenderableImageAttachment(att))
    .map((att, index) => ({
      key: `${att.fileName}-${index}`,
      fileName: att.fileName,
    }));
});

function resolveGeneratedImageSource(
  image: ChatV2GeneratedImage
): string | null {
  if (image.url && isAllowedImageUrl(image.url)) {
    return image.url;
  }
  if (image.b64_json) {
    const mimeType =
      image.mime_type && image.mime_type.startsWith("image/")
        ? image.mime_type
        : "image/png";
    return `data:${mimeType};base64,${image.b64_json}`;
  }
  return null;
}

function isAllowedImageUrl(url: string): boolean {
  if (url.startsWith("data:image/")) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === GENERATED_IMAGE_PROTOCOL
    );
  } catch {
    return false;
  }
}

function isExternalImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function openGeneratedImageFile(image: RenderableGeneratedImage): void {
  if (!image.localPath) return;
  windowInvoke(AI_FILE_OPEN, { filePath: image.localPath }).catch(
    (openErr: unknown) => {
      console.error("[ai-chat-v2] Failed to open generated image:", openErr);
    }
  );
}

/** Mark this output reported for the session (PRD FR-1.4). */
function onReportSubmitted(): void {
  reportSubmitted.value = true;
}

const toolResult = computed<Record<string, unknown>>(
  () => props.message.metadata?.toolResult ?? {}
);

// Map attach_local_images result codes to localized messages. Codes are stable
// English identifiers (PRD FR12); the UI shows the localized text.
const ATTACH_LOCAL_IMAGES_ERROR_KEY: Record<string, string> = {
  workspace_required: "workspaceRequired",
  invalid_arguments: "invalidArguments",
  image_limit_reached: "imageLimitReached",
  path_outside_workspace: "pathOutsideWorkspace",
  path_not_found: "pathNotFound",
  path_is_directory: "pathIsDirectory",
  image_file_too_large: "imageFileTooLarge",
  unsupported_image_type: "unsupportedImageType",
  image_signature_mismatch: "imageSignatureMismatch",
  image_dimensions_too_large: "imageDimensionsTooLarge",
  image_payload_too_large: "imagePayloadTooLarge",
  image_processing_failed: "imageProcessingFailed",
  permission_denied: "permissionDenied",
  cancelled: "cancelled",
};
const attachLocalImagesErrorLabel = computed((): string => {
  if (String(props.message.metadata?.toolName || "") !== "attach_local_images") {
    return "";
  }
  const code = String(toolResult.value.code ?? "");
  if (!code) return "";
  const suffix = ATTACH_LOCAL_IMAGES_ERROR_KEY[code];
  if (!suffix) return "";
  return t(`aiChatV2.imageTool.errors.${suffix}`) || "";
});

interface ToolProgressView {
  phase: string;
  message?: string;
  progress: number | null;
  partialCount: number | null;
  expectedCount: number | null;
  updatedAt: number;
}

const toolProgress = computed<ToolProgressView | null>(() => {
  const meta = props.message.metadata as
    | { toolProgress?: ToolProgressView }
    | undefined;
  return meta?.toolProgress ?? null;
});

const needsPermissionPrompt = computed(
  () => toolResult.value.needsPermissionPrompt === true
);
const executionPending = computed(
  () => toolResult.value.executionPending === true
);

const reasoningText = computed(
  () => props.message.metadata?.reasoning?.content?.trim() ?? ""
);
const hasReasoning = computed(
  () =>
    props.message.role === "assistant" &&
    props.showReasoning === true &&
    reasoningText.value.length > 0
);

const shellPreview = computed<ShellPreview | undefined>(() => {
  const preview = toolResult.value.shellPreview;
  if (!preview || typeof preview !== "object") {
    return undefined;
  }
  const shellData = preview as Record<string, unknown>;
  if (
    typeof shellData.command !== "string" ||
    typeof shellData.shell !== "string" ||
    typeof shellData.timeout_ms !== "number"
  ) {
    return undefined;
  }
  return {
    command: shellData.command,
    cwd: typeof shellData.cwd === "string" ? shellData.cwd : undefined,
    shell: shellData.shell,
    timeout_ms: shellData.timeout_ms,
  };
});

// Metadata-only file-transfer preview for the approval card (attach_local_images).
const permissionPreview = computed(() => {
  const preview = toolResult.value.permissionPreview;
  if (!preview || typeof preview !== "object") return undefined;
  const data = preview as Record<string, unknown>;
  if (
    typeof data.titleKey !== "string" ||
    typeof data.descriptionKey !== "string" ||
    typeof data.destinationLabel !== "string" ||
    !Array.isArray(data.items)
  ) {
    return undefined;
  }
  return {
    kind: "file_transfer" as const,
    titleKey: data.titleKey,
    descriptionKey: data.descriptionKey,
    destinationLabel: data.destinationLabel,
    items: (data.items as readonly unknown[]).filter(
      (i): i is string => typeof i === "string"
    ),
  };
});

// Compact metadata-only rows for a successful attach_local_images result.
// Renders prepared-image metadata only — never bytes, data URLs, or previews
// from local paths (the user did not approve those for rendering).
interface AttachLocalImageRow {
  file_name: string;
  mime_type: string;
  width: number;
  height: number;
  prepared_size_bytes: number;
}
const attachLocalImagesAttachments = computed<AttachLocalImageRow[]>(() => {
  if (String(props.message.metadata?.toolName || "") !== "attach_local_images") {
    return [];
  }
  const attachments = toolResult.value.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((a): AttachLocalImageRow | undefined => {
      if (!a || typeof a !== "object") return undefined;
      const r = a as Record<string, unknown>;
      if (
        typeof r.file_name !== "string" ||
        typeof r.mime_type !== "string" ||
        typeof r.width !== "number" ||
        typeof r.height !== "number" ||
        typeof r.prepared_size_bytes !== "number"
      ) {
        return undefined;
      }
      return {
        file_name: r.file_name,
        mime_type: r.mime_type,
        width: r.width,
        height: r.height,
        prepared_size_bytes: r.prepared_size_bytes,
      };
    })
    .filter((x): x is AttachLocalImageRow => x !== undefined);
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface MentionChip {
  variant: "resolved" | "warning";
  icon: string;
  label: string;
  reason?: string;
}

function mentionChipLabel(m: ChatV2AtMentionMetadata): string {
  let label = m.relativePath;
  if (m.kind === "directory" && !label.endsWith("/")) label += "/";
  if (m.lineStart) {
    label +=
      m.lineEnd && m.lineEnd !== m.lineStart
        ? ` L${m.lineStart}-${m.lineEnd}`
        : ` L${m.lineStart}`;
  }
  return label;
}

function mentionWarningReason(
  status: ChatV2AtMentionMetadata["status"]
): string | undefined {
  switch (status) {
    case "missing":
      return (
        t("aiChatV2.atMentions.fileNotFound") ||
        "File not found in this workspace."
      );
    case "rejected":
      return (
        t("aiChatV2.atMentions.outsideWorkspace") ||
        "Mention is outside the approved workspace."
      );
    case "invalid_line_range":
      return (
        t("aiChatV2.atMentions.invalidLineRange") ||
        "Line range must start before it ends."
      );
    case "binary":
      return t("aiChatV2.atMentions.binaryFile") || "Binary file";
    case "too_large":
      return t("aiChatV2.atMentions.tooLarge") || "File is too large to include.";
    case "workspace_required":
      return (
        t("aiChatV2.atMentions.noWorkspace") ||
        "Choose a workspace to mention files."
      );
    case "too_many_mentions":
      return (
        t("aiChatV2.atMentions.tooManyMentions") || "Too many mentions."
      );
    default:
      return "Could not be resolved.";
  }
}

const mentionChips = computed<MentionChip[]>(() => {
  if (props.message.role !== "user") return [];
  const meta = props.message.metadata as
    | { atMentions?: ChatV2AtMentionMetadata[] }
    | undefined;
  const mentions = meta?.atMentions;
  if (!mentions || mentions.length === 0) return [];
  return mentions.map(
    (m): MentionChip => {
      const label = mentionChipLabel(m);
      if (m.status === "resolved") {
        return {
          variant: "resolved",
          icon:
            m.kind === "directory"
              ? "mdi-folder-outline"
              : "mdi-file-document-outline",
          label,
        };
      }
      return {
        variant: "warning",
        icon: "mdi-alert-circle-outline",
        label,
        reason: mentionWarningReason(m.status),
      };
    }
  );
});

type PastePreviewState =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "missing" };

interface PastedChip {
  readonly id: number;
  readonly kind: ChatV2PastedBlockMetadata["kind"];
  readonly lineCount: number;
  readonly icon: string;
  readonly label: string;
  readonly inlineContent?: string;
  readonly contentHash?: string;
  readonly hasPreview: boolean;
}

const pastePreviewByHash = ref<Record<string, PastePreviewState>>({});

/** Narrow ready paste preview content for template use (union-safe). */
function pastePreviewContent(contentHash: string): string | null {
  const state = pastePreviewByHash.value[contentHash];
  return state?.status === "ready" ? state.content : null;
}

function pastedChipLabel(id: number, lineCount: number): string {
  return (
    t("aiChatV2.pastedText.chip_label", { id, lines: lineCount }) ||
    `Pasted text #${id} · ${lineCount} lines`
  );
}

function pastedTruncatedChipLabel(id: number, lineCount: number): string {
  return (
    t("aiChatV2.pastedText.truncated_chip_label", { id, lines: lineCount }) ||
    `Pasted text #${id} · ${lineCount} lines`
  );
}

async function onPasteDetailsToggle(
  chip: PastedChip,
  open: boolean
): Promise<void> {
  if (!open) return;
  if (chip.inlineContent) return; // inline previews are already present
  if (!chip.contentHash) return;

  // Already fetched (ready/loading/missing).
  if (pastePreviewByHash.value[chip.contentHash]) return;

  pastePreviewByHash.value[chip.contentHash] = { status: "loading" };
  try {
    const content = await readPasteCache(chip.contentHash);
    pastePreviewByHash.value[chip.contentHash] = content
      ? { status: "ready", content }
      : { status: "missing" };
  } catch (err) {
    console.error("[ai-chat-v2] readPasteCache failed:", err);
    pastePreviewByHash.value[chip.contentHash] = { status: "missing" };
  }
}

const pastedChips = computed<PastedChip[]>(() => {
  if (props.message.role !== "user") return [];
  const meta = props.message.metadata as
    | { pastedBlocks?: ChatV2PastedBlockMetadata[] }
    | undefined;
  const blocks = meta?.pastedBlocks;
  if (!blocks || blocks.length === 0) return [];

  return blocks.map((b): PastedChip => {
    const label =
      b.kind === "truncated"
        ? pastedTruncatedChipLabel(b.id, b.lineCount)
        : pastedChipLabel(b.id, b.lineCount);
    const icon = b.kind === "truncated" ? "mdi-alert-circle-outline" : "mdi-file-document-outline";
    const hasPreview =
      typeof b.inlineContent === "string" ||
      typeof b.contentHash === "string";
    return {
      id: b.id,
      kind: b.kind,
      lineCount: b.lineCount,
      icon,
      label,
      inlineContent: b.inlineContent,
      contentHash: b.contentHash,
      hasPreview,
    };
  });
});
</script>

<style scoped>
.v2-message {
  display: flex;
  margin: 8px 0;
}
.v2-message--plan {
  justify-content: stretch;
}
.v2-message--user {
  justify-content: flex-end;
}
.v2-message--assistant,
.v2-message--system,
.v2-message--tool {
  justify-content: flex-start;
}
.v2-message__bubble {
  max-width: 80%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  word-break: break-word;
}
.v2-message__report {
  margin-top: 4px;
  display: flex;
  align-items: center;
}
.v2-message--user .v2-message__bubble {
  background: rgba(25, 118, 210, 0.12);
}
.v2-message__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 4px;
}
.v2-message--user .v2-message__meta {
  justify-content: flex-end;
}
.v2-message__role {
  font-weight: 600;
}
.v2-message__time {
  white-space: nowrap;
}
.v2-message__content {
  white-space: pre-wrap;
  line-height: 1.45;
}
.v2-message__reasoning {
  margin-top: 8px;
  padding: 8px;
  border-left: 3px solid rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.06);
  border-radius: 6px;
}
.v2-message__reasoning summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}
.v2-message__reasoning-content {
  margin-top: 6px;
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.45;
}
.v2-message__images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  margin-top: 8px;
  max-width: min(520px, 100%);
}
.v2-message__image-link {
  display: block;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
}
.v2-message__image-button {
  padding: 0;
  color: inherit;
  cursor: pointer;
  appearance: none;
}
.v2-message__image-button:disabled {
  cursor: default;
}
.v2-message__image {
  display: block;
  width: 100%;
  height: auto;
  max-height: 360px;
  object-fit: contain;
}
/* User-sent attachment previews. Images use a smaller max-height than
   AI-generated images so multi-attachment user bubbles stay compact. */
.v2-message__attachments {
  margin-top: 8px;
}
.v2-message__attachments--images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 200px));
  gap: 8px;
  max-width: min(440px, 100%);
}
.v2-message__attachments--docs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.v2-message__attachment-image {
  display: block;
  width: 100%;
  height: auto;
  max-height: 200px;
  object-fit: cover;
}
.v2-message__tool-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.v2-message__tool-field {
  display: flex;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 6px;
}
.v2-message__tool-error {
  color: rgb(var(--v-theme-error));
  margin-bottom: 6px;
  white-space: pre-wrap;
}
.v2-message__attachments {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 6px;
}
.v2-message__attachment-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.v2-message__attachment-name {
  font-weight: 600;
  word-break: break-all;
}
.v2-message__attachment-meta {
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
}
.v2-message__details summary {
  cursor: pointer;
  font-size: 13px;
  margin-bottom: 4px;
}
.v2-message__details pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
}
.v2-message__mentions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.v2-mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(25, 118, 210, 0.12);
  color: rgba(0, 0, 0, 0.7);
}
.v2-mention-chip--warning {
  background: rgba(var(--v-theme-error), 0.12);
}
.v2-mention-chip__label {
  font-family: monospace;
}
.v2-mention-chip__reason {
  opacity: 0.75;
  font-size: 10px;
}
</style>
