<template>
  <div class="pa-4">
    <div class="d-flex align-center justify-space-between mb-3">
      <div class="text-h6">{{ t("subagents.title") }}</div>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="onAdd">
        {{ t("subagents.add_button") }}
      </v-btn>
    </div>

    <div class="d-flex ga-2 mb-3 flex-wrap align-center">
      <v-text-field
        v-model="search"
        density="compact"
        hide-details
        prepend-inner-icon="mdi-magnify"
        :placeholder="t('subagents.title')"
        style="max-width: 320px"
      />
      <v-select
        v-model="sourceFilter"
        :items="sourceFilterItems"
        item-title="label"
        item-value="value"
        density="compact"
        hide-details
        style="max-width: 160px"
      />
      <v-select
        v-model="statusFilter"
        :items="statusFilterItems"
        item-title="label"
        item-value="value"
        density="compact"
        hide-details
        style="max-width: 160px"
      />
    </div>

    <v-table v-if="filteredAgents.length > 0" density="compact">
      <thead>
        <tr>
          <th>{{ t("subagents.column_agent") }}</th>
          <th>{{ t("subagents.column_description") }}</th>
          <th>{{ t("subagents.column_source") }}</th>
          <th>{{ t("subagents.column_mode") }}</th>
          <th>{{ t("subagents.column_tools") }}</th>
          <th>{{ t("subagents.column_status") }}</th>
          <th>{{ t("subagents.column_actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="a in filteredAgents"
          :key="a.id"
          style="cursor: pointer"
          @click="selectedAgent = a"
        >
          <td>
            <div>{{ a.name }}</div>
            <div class="text-caption text-grey">{{ a.id }}</div>
          </td>
          <td class="text-truncate" style="max-width: 260px">{{ a.description }}</td>
          <td>
            <v-chip size="x-small" :color="sourceColor(a.source)">
              {{ sourceLabel(a.source) }}
            </v-chip>
          </td>
          <td>{{ a.mode }}</td>
          <td>{{ a.allowedTools.length }}</td>
          <td>
            <v-icon
              v-if="a.health !== 'healthy' || a.lastError"
              size="small"
              color="warning"
              class="mr-1"
            >
              mdi-alert-circle-outline
            </v-icon>
            {{ a.status === "active" ? t("subagents.status_active") : t("subagents.status_disabled") }}
          </td>
          <td @click.stop>
            <v-switch
              :model-value="a.status === 'active'"
              :disabled="a.source === 'built-in'"
              color="success"
              hide-details
              density="compact"
              @update:model-value="(v) => onToggle(a.id, v === true)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
    <div v-else-if="!loading" class="text-grey pa-4">
      {{ agents.length === 0 ? t("subagents.empty_state") : t("subagents.no_filter_results") }}
    </div>

    <AgentDetailPanel
      :agent="selectedAgent"
      @close="selectedAgent = undefined"
      @edit="onEdit"
      @toggle="onToggle"
      @changed="reload"
    />

    <AgentEditorDialog
      v-if="editorOpen"
      :agent="editorAgent"
      @close="editorOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  listAgentDefinitions,
  toggleAgentDefinition,
  type AgentDefinitionView,
  type AgentDefinitionSource,
} from "@/views/api/agents";
import AgentDetailPanel from "./AgentDetailPanel.vue";
import AgentEditorDialog from "./AgentEditorDialog.vue";

const { t } = useI18n();

const agents = ref<AgentDefinitionView[]>([]);
const loading = ref(true);
const search = ref("");
const sourceFilter = ref<"all" | AgentDefinitionSource>("all");
const statusFilter = ref<"all" | "enabled" | "disabled" | "warning">("all");
const selectedAgent = ref<AgentDefinitionView | undefined>(undefined);
const editorOpen = ref(false);
const editorAgent = ref<AgentDefinitionView | undefined>(undefined);

const sourceFilterItems = computed(() => [
  { label: t("subagents.column_source"), value: "all" },
  { label: t("subagents.source_builtin"), value: "built-in" },
  { label: t("subagents.source_plugin"), value: "plugin" },
  { label: t("subagents.source_workspace"), value: "workspace" },
  { label: t("subagents.source_user"), value: "user" },
]);
const statusFilterItems = computed(() => [
  { label: t("subagents.column_status"), value: "all" },
  { label: t("subagents.status_active"), value: "enabled" },
  { label: t("subagents.status_disabled"), value: "disabled" },
]);

const filteredAgents = computed(() => {
  const q = search.value.trim().toLowerCase();
  return agents.value.filter((a) => {
    if (sourceFilter.value !== "all" && a.source !== sourceFilter.value) {
      return false;
    }
    if (statusFilter.value === "enabled" && a.status !== "active") return false;
    if (statusFilter.value === "disabled" && a.status === "active") return false;
    if (
      statusFilter.value === "warning" &&
      a.health === "healthy" &&
      !a.lastError
    ) {
      return false;
    }
    if (!q) return true;
    return (
      a.id.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      (a.pluginName?.toLowerCase().includes(q) ?? false)
    );
  });
});

async function reload(): Promise<void> {
  loading.value = true;
  try {
    agents.value = (await listAgentDefinitions()) ?? [];
    if (selectedAgent.value) {
      const refreshed = agents.value.find(
        (a) => a.id === selectedAgent.value!.id
      );
      selectedAgent.value = refreshed ?? undefined;
    }
  } finally {
    loading.value = false;
  }
}

async function onToggle(agentId: string, enabled: boolean): Promise<void> {
  await toggleAgentDefinition(agentId, enabled);
  await reload();
}

function onAdd(): void {
  editorAgent.value = undefined;
  editorOpen.value = true;
}

function onEdit(agent: AgentDefinitionView): void {
  editorAgent.value = agent;
  editorOpen.value = true;
  selectedAgent.value = undefined;
}

async function onSaved(): Promise<void> {
  editorOpen.value = false;
  await reload();
}

function sourceLabel(s: AgentDefinitionSource): string {
  switch (s) {
    case "built-in":
      return t("subagents.source_builtin");
    case "plugin":
      return t("subagents.source_plugin");
    case "workspace":
      return t("subagents.source_workspace");
    default:
      return t("subagents.source_user");
  }
}

function sourceColor(s: AgentDefinitionSource): string {
  switch (s) {
    case "built-in":
      return "secondary";
    case "plugin":
      return "primary";
    case "workspace":
      return "info";
    default:
      return "success";
  }
}

onMounted(reload);
</script>
