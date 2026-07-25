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
      <div class="v2-message__role">{{ roleLabel }}</div>
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
          :workspace-root="workspaceRoot"
          @grant="(payload) => emit('grant-permission', message, payload)"
          @deny="emit('deny-permission', message)"
        />
        <template v-else>
          <div class="v2-message__tool-header">
            <v-icon
              size="small"
              :color="message.metadata?.success === false ? 'error' : 'success'"
              class="mr-1"
            >
              {{ message.metadata?.success === false ? 'mdi-alert-circle' : 'mdi-check-circle' }}
            </v-icon>
            <strong>{{ t("aiChatV2.tool_result_title") || "Tool Result" }}</strong>
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
          <div v-if="message.metadata?.error" class="v2-message__tool-error">
            {{ message.metadata.error }}
          </div>
          <div v-if="message.metadata?.summary" class="v2-message__content">
            {{ message.metadata.summary }}
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
        <div v-if="generatedImages.length > 0" class="v2-message__images">
          <a
            v-for="image in generatedImages"
            :key="image.key"
            :href="image.src"
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
        </div>
      </template>
      <AiChatV2StreamStatus
        v-if="message.role === 'assistant' && status !== 'idle'"
        :status="status"
        :error-message="errorMessage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ChatV2GeneratedImage,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";
import SkillApprovalCard from "@/views/components/aiChat/SkillApprovalCard.vue";
import AiChatV2StreamStatus from "./AiChatV2StreamStatus.vue";
import AiChatV2PlanApprovalCard from "./AiChatV2PlanApprovalCard.vue";
import AiArtifactCard from "@/views/components/aiArtifacts/AiArtifactCard.vue";

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

const roleLabel = computed(() => {
  if (props.message.role === "user") {
    return te("common.user") ? t("common.user") : "You";
  }
  if (props.message.role === "assistant") return "AI";
  return props.message.role;
});

const status = computed<Status>(() => props.status ?? "idle");
const disabled = computed(() => props.disabled ?? false);

interface RenderableGeneratedImage {
  key: string;
  src: string;
}

const generatedImages = computed<RenderableGeneratedImage[]>(() => {
  return (props.message.metadata?.generatedImages ?? [])
    .map((image, index) => {
      const src = resolveGeneratedImageSource(image);
      return src ? { key: `${src}-${index}`, src } : null;
    })
    .filter((image): image is RenderableGeneratedImage => image !== null);
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

const toolResult = computed<Record<string, unknown>>(
  () => props.message.metadata?.toolResult ?? {}
);

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
.v2-message--user .v2-message__bubble {
  background: rgba(25, 118, 210, 0.12);
}
.v2-message__role {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 2px;
}
.v2-message__content {
  white-space: pre-wrap;
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
.v2-message__image {
  display: block;
  width: 100%;
  height: auto;
  max-height: 360px;
  object-fit: contain;
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
</style>
