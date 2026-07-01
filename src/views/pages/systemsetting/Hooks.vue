<template>
  <v-container fluid>
    <!-- Header -->
    <v-row align="center" class="mb-2">
      <v-col cols="6">
        <v-switch
          v-model="globalEnabled"
          :label="t('system_settings.hooks.global_enable') || 'Enable hooks globally'"
          color="primary"
          hide-details
          @update:model-value="onGlobalToggle"
        />
      </v-col>
      <v-col cols="6" class="text-right">
        <v-btn color="primary" @click="onAddNew">
          <v-icon left>mdi-plus</v-icon>
          {{ t('system_settings.hooks.add_command') || '+ Add command hook' }}
        </v-btn>
      </v-col>
    </v-row>

    <v-alert v-if="!globalEnabled" type="warning" density="compact" class="mb-2">
      {{ t('system_settings.hooks.global_disable_banner') || 'Hooks are globally disabled — no hook will fire.' }}
    </v-alert>

    <!-- Filters -->
    <v-row dense class="mb-2">
      <v-col cols="3">
        <v-select
          v-model="filterEvent"
          :items="eventOptions"
          :label="t('system_settings.hooks.filter_event') || 'Event'"
          density="compact"
          clearable
        />
      </v-col>
      <v-col cols="3">
        <v-select
          v-model="filterSource"
          :items="sourceOptions"
          :label="t('system_settings.hooks.filter_source') || 'Source'"
          density="compact"
        />
      </v-col>
      <v-col cols="3">
        <v-checkbox
          v-model="showSession"
          :label="t('system_settings.hooks.show_session') || 'Show session hooks'"
          density="compact"
          hide-details
        />
      </v-col>
    </v-row>

    <!-- Master-detail -->
    <v-row>
      <v-col cols="5">
        <v-card>
          <v-card-title>
            {{ t('system_settings.hooks.title') || 'Hooks Management' }}
            <v-chip size="x-small" class="ml-2">{{ visibleHooks.length }}</v-chip>
          </v-card-title>
          <v-divider />
          <v-list density="compact" style="max-height: 480px; overflow-y: auto;">
            <v-list-item
              v-for="hook in visibleHooks"
              :key="hook.id"
              :active="selectedId === hook.id"
              @click="onSelect(hook.id)"
            >
              <v-list-item-title>
                <v-icon small class="mr-1">{{ iconFor(hook) }}</v-icon>
                {{ hook.id }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ hook.eventName }} · {{ hook.source }}
                <span v-if="isUntrustedCommand(hook)"> · ⚠ {{ t('system_settings.hooks.trust_required') || 'Trust required' }}</span>
              </v-list-item-subtitle>
            </v-list-item>
            <v-list-item v-if="visibleHooks.length === 0">
              <v-list-item-title class="text--disabled">
                {{ t('system_settings.hooks.list_empty') || 'No hooks configured yet' }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <v-col cols="7">
        <v-card>
          <v-card-title>{{ editorTitle }}</v-card-title>
          <v-card-text v-if="!selectedHook && !creating">
            <p class="text--disabled">
              {{ t('system_settings.hooks.create_first') || 'Create your first command hook' }}
            </p>
          </v-card-text>
          <v-card-text v-else>
            <v-text-field
              v-model="form.id"
              :label="t('system_settings.hooks.field.event') || 'Hook ID'"
              :disabled="!creating"
              density="compact"
              class="mb-2"
            />
            <v-select
              v-model="form.eventName"
              :items="eventOptions"
              :label="t('system_settings.hooks.field.event') || 'Event'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model="form.matcher"
              :label="t('system_settings.hooks.field.matcher') || 'Matcher'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model="form.command"
              :label="t('system_settings.hooks.field.command') || 'Command'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model.number="form.timeoutMs"
              type="number"
              :label="t('system_settings.hooks.field.timeout') || 'Timeout (ms)'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-select
              v-model="form.failureMode"
              :items="['warn', 'block']"
              :label="t('system_settings.hooks.field.failure_mode') || 'Failure mode'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model="form.statusMessage"
              :label="t('system_settings.hooks.field.status_message') || 'Status message'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />

            <div class="mt-2">
              <v-btn
                v-if="isUserSource"
                color="primary"
                variant="outlined"
                class="mr-2"
                @click="onSave"
              >
                {{ t('system_settings.hooks.button.save') || 'Save' }}
              </v-btn>
              <v-btn
                v-if="canTrust"
                color="warning"
                variant="outlined"
                class="mr-2"
                @click="onTrust"
              >
                {{ t('system_settings.hooks.button.trust') || 'Trust' }}
              </v-btn>
              <v-btn
                v-if="canUntrust"
                variant="outlined"
                class="mr-2"
                @click="onUntrust"
              >
                {{ t('system_settings.hooks.button.untrust') || 'Untrust' }}
              </v-btn>
              <v-btn
                v-if="isUserSource && !creating"
                color="error"
                variant="outlined"
                @click="onDelete"
              >
                {{ t('system_settings.hooks.button.delete') || 'Delete' }}
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Audit panel -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>
            {{ t('system_settings.hooks.audit_title') || 'Recent audit log' }}
          </v-card-title>
          <v-card-text>
            <v-row dense class="mb-2">
              <v-col cols="3">
                <v-select
                  v-model="auditFilter.eventName"
                  :items="eventOptions"
                  label="Event"
                  clearable
                  density="compact"
                />
              </v-col>
              <v-col cols="3">
                <v-select
                  v-model="auditFilter.status"
                  :items="['started','success','blocked','failed','timeout']"
                  label="Status"
                  clearable
                  density="compact"
                />
              </v-col>
              <v-col cols="3">
                <v-select
                  v-model="auditFilter.hookId"
                  :items="hookIdOptions"
                  label="Hook"
                  clearable
                  density="compact"
                />
              </v-col>
              <v-col cols="3">
                <v-select
                  v-model="auditLimit"
                  :items="[100, 500, 1000]"
                  label="Last N rows"
                  density="compact"
                />
              </v-col>
            </v-row>
            <v-data-table
              :headers="auditHeaders"
              :items="auditRows"
              :items-per-page="10"
              density="compact"
            >
              <template #item.timestamp="{ item }">
                {{ formatTime(item.timestamp) }}
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Trust confirm dialog -->
    <v-dialog v-model="trustDialog" max-width="500">
      <v-card>
        <v-card-title>
          {{ t('system_settings.hooks.trust_confirm_title') || 'Trust this command hook?' }}
        </v-card-title>
        <v-card-text>
          {{ t('system_settings.hooks.trust_confirm_body') || 'Trusting means the local process will run on every matching event.' }}
          <br /><code>{{ form.command }}</code>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="trustDialog = false">
            {{ t('system_settings.hooks.button.cancel') || 'Cancel' }}
          </v-btn>
          <v-btn color="warning" @click="confirmTrust">
            {{ t('system_settings.hooks.button.trust') || 'Trust' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="deleteDialog" max-width="500">
      <v-card>
        <v-card-title>
          {{ t('system_settings.hooks.delete_confirm_title') || 'Delete this hook?' }}
        </v-card-title>
        <v-card-text>
          {{ t('system_settings.hooks.delete_confirm_body') || 'This action cannot be undone.' }}
          <br /><code>{{ form.id }}</code>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="deleteDialog = false">
            {{ t('system_settings.hooks.button.cancel') || 'Cancel' }}
          </v-btn>
          <v-btn color="error" @click="confirmDelete">
            {{ t('system_settings.hooks.button.delete') || 'Delete' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  listHooks, createHook, updateHook, deleteHook,
  setHookEnabled, setHookTrusted,
  getHooksGlobalEnable, setHooksGlobalEnable,
  listHookAudit,
  type NewHookInput,
} from "@/views/api/hooks";
import type {
  HookDefinition, HookEventName, HookAuditEntry, HookAuditStatus,
} from "@/entityTypes/hookTypes";

const { t } = useI18n();

const EVENT_NAMES: HookEventName[] = [
  "SessionStart", "UserPromptSubmit", "PreToolUse",
  "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "PermissionDenied", "Stop",
];
const eventOptions = EVENT_NAMES;
const sourceOptions = ["all", "builtin", "user"];

const globalEnabled = ref(false);
const filterEvent = ref<HookEventName | undefined>(undefined);
const filterSource = ref<"all" | "builtin" | "user">("all");
const showSession = ref(false);
const allHooks = ref<HookDefinition[]>([]);
const selectedId = ref<string | null>(null);
const creating = ref(false);

const form = ref({
  id: "",
  eventName: "PreToolUse" as HookEventName,
  matcher: "*",
  command: "",
  cwd: "",
  timeoutMs: 5000,
  failureMode: "warn" as "warn" | "block",
  statusMessage: "",
});

const trustDialog = ref(false);
const deleteDialog = ref(false);

// Audit
const auditRows = ref<HookAuditEntry[]>([]);
const auditFilter = ref<{ eventName?: HookEventName; status?: HookAuditStatus; hookId?: string }>({});
const auditLimit = ref(100);

const auditHeaders = [
  { title: "Time", key: "timestamp", sortable: true },
  { title: "Hook", key: "hookId" },
  { title: "Event", key: "eventName" },
  { title: "Status", key: "status" },
  { title: "Duration", key: "durationMs" },
  { title: "Reason", key: "reason" },
];

const visibleHooks = computed(() => allHooks.value);
const selectedHook = computed(() =>
  allHooks.value.find((h) => h.id === selectedId.value) ?? null
);
const isUserSource = computed(() =>
  creating.value || selectedHook.value?.source === "user"
);
const canTrust = computed(() =>
  !creating.value &&
  selectedHook.value?.source === "user" &&
  selectedHook.value?.type === "command" &&
  selectedHook.value?.trusted !== true
);
const canUntrust = computed(() =>
  !creating.value &&
  selectedHook.value?.source === "user" &&
  selectedHook.value?.type === "command" &&
  selectedHook.value?.trusted === true
);
const editorTitle = computed(() => {
  if (creating.value) return t("system_settings.hooks.add_command") || "+ Add command hook";
  if (selectedHook.value) return selectedHook.value.id;
  return "";
});
const hookIdOptions = computed(() => allHooks.value.map((h) => h.id));

function isUntrustedCommand(hook: HookDefinition): boolean {
  return hook.source === "user" && hook.type === "command" && !hook.trusted;
}
function iconFor(hook: HookDefinition): string {
  if (hook.source === "builtin") return hook.enabled ? "mdi-check" : "mdi-pause";
  if (isUntrustedCommand(hook)) return "mdi-alert";
  return hook.enabled ? "mdi-check" : "mdi-pause";
}

function formatTime(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toLocaleString();
}

async function loadAll() {
  try {
    allHooks.value = await listHooks({
      source: filterSource.value === "all" ? undefined : filterSource.value,
      includeSession: showSession.value,
      eventName: filterEvent.value,
    });
  } catch (err) {
    console.error("hooks:list failed", err);
  }
}

async function loadAudit() {
  try {
    const result = await listHookAudit({
      ...auditFilter.value,
      limit: auditLimit.value,
      offset: 0,
    });
    auditRows.value = result.rows;
  } catch (err) {
    console.error("hooks:listAudit failed", err);
  }
}

async function onGlobalToggle(value: boolean | null) {
  const enabled = value === null ? false : value;
  try {
    await setHooksGlobalEnable(enabled);
    globalEnabled.value = enabled;
  } catch (err) {
    console.error(err);
    globalEnabled.value = !enabled; // revert
  }
}

function onSelect(id: string) {
  creating.value = false;
  selectedId.value = id;
  const hook = allHooks.value.find((h) => h.id === id);
  if (!hook || hook.type !== "command") return;
  form.value = {
    id: hook.id,
    eventName: hook.eventName,
    matcher: hook.matcher ?? "*",
    command: hook.command,
    cwd: hook.cwd ?? "",
    timeoutMs: hook.timeoutMs ?? 5000,
    failureMode: hook.failureMode ?? "warn",
    statusMessage: hook.statusMessage ?? "",
  };
}

function onAddNew() {
  creating.value = true;
  selectedId.value = null;
  form.value = {
    id: "",
    eventName: "PreToolUse",
    matcher: "*",
    command: "",
    cwd: "",
    timeoutMs: 5000,
    failureMode: "warn",
    statusMessage: "",
  };
}

async function onSave() {
  try {
    if (creating.value) {
      const input: NewHookInput = {
        id: form.value.id,
        eventName: form.value.eventName,
        matcher: form.value.matcher,
        command: form.value.command,
        cwd: form.value.cwd || undefined,
        timeoutMs: form.value.timeoutMs,
        failureMode: form.value.failureMode,
        statusMessage: form.value.statusMessage || undefined,
        enabled: false, // user must explicitly enable after create
        trusted: false,
      };
      await createHook(input);
    } else if (selectedHook.value?.source === "user") {
      await updateHook(form.value.id, {
        matcher: form.value.matcher,
        command: form.value.command,
        cwd: form.value.cwd || null,
        timeoutMs: form.value.timeoutMs,
        failureMode: form.value.failureMode,
        statusMessage: form.value.statusMessage || null,
      });
    }
    creating.value = false;
    await loadAll();
  } catch (err) {
    console.error("save failed", err);
    alert(String(err));
  }
}

function onTrust() { trustDialog.value = true; }
function onUntrust() { void doUntrust(); }
async function doUntrust() {
  if (!selectedHook.value) return;
  try {
    await setHookTrusted(selectedHook.value.id, false);
    await loadAll();
  } catch (err) {
    console.error(err);
  }
}
async function confirmTrust() {
  trustDialog.value = false;
  if (!selectedHook.value) return;
  try {
    await setHookTrusted(selectedHook.value.id, true);
    await loadAll();
  } catch (err) {
    console.error(err);
  }
}

function onDelete() { deleteDialog.value = true; }
async function confirmDelete() {
  deleteDialog.value = false;
  if (!selectedHook.value) return;
  try {
    await deleteHook(selectedHook.value.id);
    selectedId.value = null;
    await loadAll();
  } catch (err) {
    console.error(err);
    alert(String(err));
  }
}

watch([filterSource, filterEvent, showSession], () => { void loadAll(); });
watch([auditFilter, auditLimit], () => { void loadAudit(); }, { deep: true });

onMounted(async () => {
  try {
    globalEnabled.value = await getHooksGlobalEnable();
  } catch (err) {
    console.error("getHooksGlobalEnable failed", err);
  }
  await loadAll();
  await loadAudit();
});
</script>
