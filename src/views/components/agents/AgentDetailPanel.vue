<template>
  <v-navigation-drawer
    :model-value="!!agent"
    location="right"
    width="420"
    temporary
    @update:model-value="(v) => !v && $emit('close')"
  >
    <template v-if="agent">
      <div class="d-flex align-center justify-space-between pa-4">
        <div>
          <div class="text-h6">{{ agent.name }}</div>
          <div class="text-caption text-grey">{{ agent.id }}</div>
        </div>
        <v-btn icon size="small" variant="text" @click="$emit('close')">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>
      <v-divider />

      <div class="pa-4 d-flex align-center ga-2 flex-wrap">
        <v-chip size="small" :color="sourceColor">{{ sourceLabel }}</v-chip>
        <v-chip v-if="agent.pluginName" size="small" color="primary">
          {{ agent.pluginName }}
        </v-chip>
        <v-chip
          size="small"
          :color="agent.status === 'active' ? 'success' : 'default'"
        >
          {{ agent.status === "active" ? t("subagents.status_active") : t("subagents.status_disabled") }}
        </v-chip>
        <v-chip
          v-if="agent.health !== 'healthy'"
          size="small"
          color="warning"
        >
          {{ agent.health }}
        </v-chip>
      </div>

      <v-list density="compact" class="px-2">
        <v-list-item>
          <v-list-item-subtitle>{{ t("subagents.column_description") }}</v-list-item-subtitle>
          <div class="text-body-2">{{ agent.description }}</div>
        </v-list-item>
        <v-list-item>
          <v-list-item-subtitle>{{ t("subagents.column_mode") }}</v-list-item-subtitle>
          <div class="text-body-2">{{ agent.mode }}</div>
        </v-list-item>
        <v-list-item v-if="agent.defaultModel">
          <v-list-item-subtitle>{{ t("subagents.column_model") }}</v-list-item-subtitle>
          <div class="text-body-2">{{ agent.defaultModel }}</div>
        </v-list-item>
        <v-list-item>
          <v-list-item-subtitle>{{ t("subagents.field_max_tool_calls") }}</v-list-item-subtitle>
          <div class="text-body-2">{{ agent.maxToolCalls }}</div>
        </v-list-item>
        <v-list-item>
          <v-list-item-subtitle>{{ t("subagents.field_max_runtime_seconds") }}</v-list-item-subtitle>
          <div class="text-body-2">{{ Math.round(agent.maxRuntimeMs / 1000) }}</div>
        </v-list-item>
        <v-list-item>
          <v-list-item-subtitle>{{ t("subagents.field_max_continue_calls") }}</v-list-item-subtitle>
          <div class="text-body-2">{{ agent.maxContinueCalls }}</div>
        </v-list-item>
        <v-list-item v-if="agent.pluginComponentPath">
          <v-list-item-subtitle>{{ t("subagents.column_plugin") }}</v-list-item-subtitle>
          <div class="text-body-2 text-break">{{ agent.pluginComponentPath }}</div>
        </v-list-item>
      </v-list>

      <div class="px-4 pb-2">
        <div class="text-caption text-grey mb-1">{{ t("subagents.column_tools") }}</div>
        <div class="d-flex ga-1 flex-wrap">
          <v-chip
            v-for="tool in agent.allowedTools"
            :key="tool"
            size="x-small"
            variant="outlined"
          >
            {{ tool }}
          </v-chip>
          <span v-if="agent.allowedTools.length === 0" class="text-grey text-body-2">—</span>
        </div>
      </div>

      <div class="px-4 pb-2">
        <div class="text-caption text-grey mb-1">{{ t("subagents.field_system_prompt") }}</div>
        <pre class="text-body-2 bg-grey-lighten-4 pa-2 rounded overflow-auto" style="max-height: 240px">{{ agent.systemPrompt }}</pre>
        <div v-if="isReadonly" class="text-caption text-grey mt-1">
          {{ source === "plugin" ? t("subagents.readonly_plugin_hint") : t("subagents.readonly_builtin_hint") }}
        </div>
      </div>

      <div class="pa-4 d-flex ga-2 flex-wrap">
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
      </div>

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
    </template>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { deleteAgentDefinition, type AgentDefinitionView } from "@/views/api/agents";

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

const source = computed(() => props.agent?.source ?? "user");
const isReadonly = computed(() => source.value !== "user");
const sourceLabel = computed(() => {
  switch (source.value) {
    case "built-in":
      return t("subagents.source_builtin");
    case "plugin":
      return t("subagents.source_plugin");
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
    default:
      return "success";
  }
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
