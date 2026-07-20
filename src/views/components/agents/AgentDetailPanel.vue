<template>
  <v-dialog
    :model-value="!!agent"
    max-width="860"
    scrollable
    @update:model-value="(v) => !v && $emit('close')"
  >
    <v-card v-if="agent">
      <v-card-title class="d-flex align-center justify-space-between">
        <div>
          <div class="text-h6">{{ agent.name }}</div>
          <div class="text-caption text-grey">{{ agent.id }}</div>
        </div>
        <v-btn icon size="small" variant="text" @click="$emit('close')">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text>
        <div class="d-flex align-center ga-2 flex-wrap mb-4">
          <v-chip size="small" :color="sourceColor">{{ sourceLabel }}</v-chip>
          <v-chip v-if="agent.pluginName" size="small" color="primary">
            {{ agent.pluginName }}
          </v-chip>
          <v-chip
            size="small"
            :color="agent.status === 'active' ? 'success' : 'default'"
          >
            {{
              agent.status === "active"
                ? t("subagents.status_active")
                : t("subagents.status_disabled")
            }}
          </v-chip>
          <v-chip
            v-if="agent.health !== 'healthy'"
            size="small"
            color="warning"
          >
            {{ agent.health }}
          </v-chip>
        </div>

        <v-list density="compact" class="px-0">
          <v-list-item>
            <v-list-item-subtitle>{{
              t("subagents.field_id")
            }}</v-list-item-subtitle>
            <div class="text-body-2 text-break">{{ agent.id }}</div>
          </v-list-item>
          <v-list-item>
            <v-list-item-subtitle>{{
              t("subagents.field_display_name")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.name }}</div>
          </v-list-item>
          <v-list-item>
            <v-list-item-subtitle>{{
              t("subagents.column_description")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.description }}</div>
          </v-list-item>
          <v-list-item v-if="sourceFileLocation">
            <v-list-item-subtitle>{{
              t("subagents.field_source_file")
            }}</v-list-item-subtitle>
            <div class="text-body-2 text-break">{{ sourceFileLocation }}</div>
          </v-list-item>
          <v-list-item>
            <v-list-item-subtitle>{{
              t("subagents.column_mode")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.mode }}</div>
          </v-list-item>
          <v-list-item v-if="agent.defaultModel">
            <v-list-item-subtitle>{{
              t("subagents.column_model")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.defaultModel }}</div>
          </v-list-item>
          <v-list-item>
            <v-list-item-subtitle>{{
              t("subagents.field_max_tool_calls")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.maxToolCalls }}</div>
          </v-list-item>
          <v-list-item>
            <v-list-item-subtitle>{{
              t("subagents.field_max_runtime_seconds")
            }}</v-list-item-subtitle>
            <div class="text-body-2">
              {{ Math.round(agent.maxRuntimeMs / 1000) }}
            </div>
          </v-list-item>
          <v-list-item>
            <v-list-item-subtitle>{{
              t("subagents.field_max_continue_calls")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.maxContinueCalls }}</div>
          </v-list-item>
          <v-list-item v-if="agent.pluginComponentPath">
            <v-list-item-subtitle>{{
              t("subagents.field_component_path")
            }}</v-list-item-subtitle>
            <div class="text-body-2 text-break">
              {{ agent.pluginComponentPath }}
            </div>
          </v-list-item>
          <v-list-item v-if="agent.updatedAt">
            <v-list-item-subtitle>{{
              t("subagents.field_last_updated")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.updatedAt }}</div>
          </v-list-item>
          <v-list-item v-if="agent.createdAt">
            <v-list-item-subtitle>{{
              t("subagents.field_created_at")
            }}</v-list-item-subtitle>
            <div class="text-body-2">{{ agent.createdAt }}</div>
          </v-list-item>
        </v-list>

        <div class="py-2">
          <div class="text-caption text-grey mb-1">
            {{ t("subagents.column_tools") }}
          </div>
          <div class="d-flex ga-1 flex-wrap">
            <v-chip
              v-for="tool in agent.allowedTools"
              :key="tool"
              size="x-small"
              variant="outlined"
            >
              {{ tool }}
            </v-chip>
            <span
              v-if="agent.allowedTools.length === 0"
              class="text-grey text-body-2"
              >—</span
            >
          </div>
        </div>

        <div class="py-2">
          <div class="text-caption text-grey mb-1">
            {{ t("subagents.field_output_schema") }}
          </div>
          <pre
            class="text-body-2 bg-grey-lighten-4 pa-2 rounded overflow-auto"
            style="max-height: 180px"
            >{{ outputSchemaText }}</pre
          >
        </div>

        <div class="py-2">
          <div class="text-caption text-grey mb-1">
            {{ t("subagents.field_warnings") }}
          </div>
          <div v-if="warnings.length > 0" class="d-flex ga-1 flex-wrap">
            <v-chip
              v-for="warning in warnings"
              :key="warning"
              size="small"
              color="warning"
              variant="tonal"
            >
              {{ warning }}
            </v-chip>
          </div>
          <div v-else class="text-body-2 text-grey">
            {{ t("subagents.field_no_warnings") }}
          </div>
        </div>

        <div class="py-2">
          <div class="text-caption text-grey mb-1">
            {{ t("subagents.field_system_prompt") }}
          </div>
          <pre
            class="text-body-2 bg-grey-lighten-4 pa-2 rounded overflow-auto"
            style="max-height: 260px"
            >{{ agent.systemPrompt }}</pre
          >
          <div v-if="isReadonly" class="text-caption text-grey mt-1">
            {{ readonlyHint }}
          </div>
        </div>
      </v-card-text>

      <v-divider />
      <v-card-actions class="d-flex ga-2 flex-wrap">
        <v-switch
          :model-value="agent.status === 'active'"
          :label="t('subagents.field_enabled')"
          color="success"
          hide-details
          density="compact"
          @update:model-value="(v) => $emit('toggle', agent!.id, v === true)"
        />
        <v-spacer />
        <v-btn
          v-if="source === 'user'"
          variant="tonal"
          prepend-icon="mdi-pencil"
          @click="$emit('edit', agent)"
        >
          {{ t("subagents.edit_title") }}
        </v-btn>
        <v-btn
          v-if="source === 'user'"
          color="error"
          variant="text"
          prepend-icon="mdi-delete"
          @click="onDelete"
        >
          {{ t("subagents.delete_confirm") }}
        </v-btn>
      </v-card-actions>

      <v-dialog v-model="confirmDelete" max-width="400">
        <v-card>
          <v-card-text>{{ t("subagents.delete_confirm") }}</v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="confirmDelete = false">
              {{ t("subagents.button_cancel") }}
            </v-btn>
            <v-btn color="error" :loading="deleting" @click="confirmDeleteYes">
              {{ t("subagents.delete_confirm") }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  deleteAgentDefinition,
  type AgentDefinitionView,
} from "@/views/api/agents";

const props = defineProps<{ agent: AgentDefinitionView | undefined }>();
const emit = defineEmits<{
  close: [];
  edit: [AgentDefinitionView];
  toggle: [string, boolean];
  changed: [];
}>();
const { t } = useI18n();

const confirmDelete = ref(false);
const deleting = ref(false);

interface AgentSourceLocation {
  readonly sourceId?: string;
  readonly sourceLabel?: string;
  readonly relativePath?: string;
  readonly rootPath?: string;
}

const source = computed(() => props.agent?.source ?? "user");
const isReadonly = computed(() => source.value !== "user");
const sourceLocation = computed<AgentSourceLocation | null>(() => {
  const value = props.agent?.manifest?.sourceLocation;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const location = value as Record<string, unknown>;
  return {
    sourceId:
      typeof location.sourceId === "string" ? location.sourceId : undefined,
    sourceLabel:
      typeof location.sourceLabel === "string"
        ? location.sourceLabel
        : undefined,
    relativePath:
      typeof location.relativePath === "string"
        ? location.relativePath
        : undefined,
    rootPath:
      typeof location.rootPath === "string" ? location.rootPath : undefined,
  };
});
const sourceFileLocation = computed(() => {
  const location = sourceLocation.value;
  if (location?.relativePath) {
    if (location.rootPath) {
      return `${location.rootPath.replace(/\/+$/, "")}/${
        location.relativePath
      }`;
    }
    if (location.sourceId === "user") {
      return `~/.aifetchly/${location.relativePath}`;
    }
    const label = location.sourceLabel ?? sourceLabel.value;
    return `${label} / ${location.relativePath}`;
  }
  return props.agent?.pluginComponentPath ?? "";
});
const sourceLabel = computed(() => {
  switch (source.value) {
    case "built-in":
      return t("subagents.source_builtin");
    case "plugin":
      return t("subagents.source_plugin");
    case "workspace":
      return t("subagents.source_workspace");
    default:
      return t("subagents.source_user");
  }
});
const sourceColor = computed(() => {
  switch (source.value) {
    case "built-in":
      return "secondary";
    case "plugin":
      return "primary";
    case "workspace":
      return "info";
    default:
      return "success";
  }
});
const readonlyHint = computed(() => {
  switch (source.value) {
    case "plugin":
      return t("subagents.readonly_plugin_hint");
    case "workspace":
      return t("subagents.readonly_workspace_hint");
    default:
      return t("subagents.readonly_builtin_hint");
  }
});
const outputSchemaText = computed(() =>
  JSON.stringify(props.agent?.outputSchema ?? {}, null, 2)
);
const warnings = computed(() => {
  const values: string[] = [];
  if (!props.agent) return values;
  if (props.agent.health !== "healthy") values.push(props.agent.health);
  if (props.agent.lastError) values.push(props.agent.lastError);
  return values;
});

function onDelete(): void {
  confirmDelete.value = true;
}

async function confirmDeleteYes(): Promise<void> {
  if (!props.agent) return;
  deleting.value = true;
  try {
    await deleteAgentDefinition(props.agent.id);
    emit("changed");
    emit("close");
  } finally {
    deleting.value = false;
    confirmDelete.value = false;
  }
}
</script>
