<template>
  <v-card
    variant="flat"
    data-testid="skill-install-manager"
    class="skill-install-manager"
  >
    <v-card-title class="d-flex align-center text-body-1">
      <v-icon class="mr-2" size="20">mdi-download-box-outline</v-icon>
      <span>{{ t("skillInstall.manager.title") }}</span>
      <v-spacer />
      <v-btn
        size="small"
        variant="text"
        icon="mdi-refresh"
        :loading="loading"
        data-testid="skill-install-manager-refresh"
        @click="load"
      />
    </v-card-title>
    <v-divider />

    <v-card-text>
      <div
        v-if="!loading && installations.length === 0"
        class="text-body-2 text-medium-emphasis"
        data-testid="skill-install-manager-empty"
      >
        {{ t("skillInstall.manager.empty") }}
      </div>

      <v-expansion-panels v-else variant="accordion" multiple>
        <v-expansion-panel
          v-for="item in installations"
          :key="item.installationId"
          :data-testid="`skill-install-manager-row-${item.name}`"
        >
          <v-expansion-panel-title>
            <span class="font-weight-medium">{{ item.name }}</span>
            <v-chip
              size="x-small"
              class="ml-2"
              variant="tonal"
              :color="statusColor(item)"
              data-testid="skill-install-manager-status"
            >
              {{ item.status }}
            </v-chip>
            <v-chip size="x-small" class="ml-1" variant="tonal">
              {{ item.kind }}
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <!-- PRD §22.3 detail fields -->
            <div class="text-caption text-medium-emphasis">
              <div data-testid="skill-install-manager-source">
                {{ t("skillInstall.manager.source") }}: {{ item.sourceUri }}
                @ {{ item.sourceRevision }}
              </div>
              <div>
                {{ t("skillInstall.manager.mode") }}: {{ item.activationMode }}
              </div>
              <div data-testid="skillInstall.manager-credentials">
                {{ t("skillInstall.manager.credentials") }}:
                {{
                  item.credentialNames.length > 0
                    ? item.credentialNames.join(", ")
                    : t("skillInstall.manager.none")
                }}
              </div>
            </div>

            <!-- Repair report -->
            <div
              v-if="repairReports[item.installationId]"
              class="text-caption mt-2"
              data-testid="skill-install-manager-repair"
            >
              <div
                :class="
                  repairReports[item.installationId]?.ok
                    ? 'text-success'
                    : 'text-error'
                "
              >
                {{ repairReports[item.installationId]?.ok }}
              </div>
              <div
                v-for="check in repairReports[item.installationId]?.checks ??
                  []"
                :key="check.name"
                :class="check.passed ? 'text-success' : 'text-warning'"
              >
                {{ check.name }}: {{ check.passed ? "ok" : check.detail }}
              </div>
            </div>

            <div class="d-flex ga-2 flex-wrap mt-2">
              <v-btn
                size="x-small"
                variant="outlined"
                :loading="busy === item.installationId"
                data-testid="skill-install-manager-update"
                @click="onUpdate(item)"
              >
                {{ t("skillInstall.manager.update") }}
              </v-btn>
              <v-btn
                size="x-small"
                variant="outlined"
                :loading="busy === item.installationId"
                data-testid="skill-install-manager-repair-btn"
                @click="onRepair(item)"
              >
                {{ t("skillInstall.manager.repair") }}
              </v-btn>
              <v-btn
                size="x-small"
                variant="outlined"
                :loading="busy === item.installationId"
                data-testid="skill-install-manager-toggle"
                @click="onToggle(item)"
              >
                {{
                  item.enabled
                    ? t("skillInstall.manager.disable")
                    : t("skillInstall.manager.enable")
                }}
              </v-btn>
              <v-btn
                size="x-small"
                color="error"
                variant="outlined"
                :loading="busy === item.installationId"
                data-testid="skill-install-manager-uninstall"
                @click="confirmUninstall = item"
              >
                {{ t("skillInstall.manager.uninstall") }}
              </v-btn>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>

    <!-- Uninstall confirmation (destructive) -->
    <v-dialog
      :model-value="confirmUninstall !== null"
      max-width="420"
      data-testid="skill-install-manager-uninstall-dialog"
      @update:model-value="confirmUninstall = null"
    >
      <v-card v-if="confirmUninstall">
        <v-card-title>
          {{ t("skillInstall.manager.uninstallTitle", { name: confirmUninstall.name }) }}
        </v-card-title>
        <v-card-text class="text-body-2">
          {{ t("skillInstall.manager.uninstallHint") }}
          <v-checkbox
            v-model="deleteSecrets"
            :label="t('skillInstall.manager.deleteSecrets')"
            density="compact"
            hide-details
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" @click="confirmUninstall = null">
            {{ t("skillInstall.manager.cancel") }}
          </v-btn>
          <v-btn
            size="small"
            color="error"
            variant="flat"
            :loading="busy !== null"
            data-testid="skill-install-manager-uninstall-confirm"
            @click="onUninstall"
          >
            {{ t("skillInstall.manager.uninstall") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  disableSkillInstall,
  enableSkillInstall,
  listSkillInstallations,
  repairSkillInstall,
  uninstallSkillInstall,
  updateSkillInstall,
  type SkillInstallationView,
  type SkillRepairReport,
} from "@/views/api/skillInstallation";

const { t } = useI18n();
const installations = ref<SkillInstallationView[]>([]);
const loading = ref(false);
const busy = ref<string | null>(null);
const repairReports = ref<Record<string, SkillRepairReport>>({});
const confirmUninstall = ref<SkillInstallationView | null>(null);
const deleteSecrets = ref(true);

onMounted(() => {
  void load();
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const rows = await listSkillInstallations();
    installations.value = rows ?? [];
  } finally {
    loading.value = false;
  }
}

function statusColor(item: SkillInstallationView): string {
  if (item.status === "ready" && item.enabled) return "success";
  if (item.status === "disabled") return "grey";
  if (item.status === "failed" || item.status === "revoked") return "error";
  return "primary";
}

async function onUpdate(item: SkillInstallationView): Promise<void> {
  busy.value = item.installationId;
  try {
    const snapshot = await updateSkillInstall({
      installationId: item.installationId,
    });
    // An update holds at plan review — surface where to continue.
    if (snapshot) {
      alert(
        snapshot.state === "awaiting_approval"
          ? t("skillInstall.manager.updateApprovalHint")
          : (snapshot.safeSummary ?? "")
      );
    }
    await load();
  } finally {
    busy.value = null;
  }
}

async function onRepair(item: SkillInstallationView): Promise<void> {
  busy.value = item.installationId;
  try {
    const report = await repairSkillInstall({
      installationId: item.installationId,
    });
    if (report) {
      // Immutable update per report.
      repairReports.value = {
        ...repairReports.value,
        [item.installationId]: report,
      };
    }
  } finally {
    busy.value = null;
  }
}

async function onToggle(item: SkillInstallationView): Promise<void> {
  busy.value = item.installationId;
  try {
    if (item.enabled) {
      await disableSkillInstall(item.installationId);
    } else {
      await enableSkillInstall(item.installationId);
    }
    await load();
  } finally {
    busy.value = null;
  }
}

async function onUninstall(): Promise<void> {
  const item = confirmUninstall.value;
  if (!item) return;
  busy.value = item.installationId;
  try {
    const result = await uninstallSkillInstall({
      installationId: item.installationId,
      ...(deleteSecrets.value ? { deleteSecrets: true } : { deleteSecrets: false }),
    });
    if (result && !result.ok) {
      alert(result.message);
    }
    confirmUninstall.value = null;
    await load();
  } finally {
    busy.value = null;
  }
}
</script>

<style scoped>
.skill-install-manager {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
