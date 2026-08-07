<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t("about.title") || "About aiFetchly" }}</span>
        <v-btn icon size="small" variant="text" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>

      <v-card-text>
        <!-- Identity -->
        <v-row dense align="center">
          <v-col cols="12" sm="3" class="text-subtitle-2 text-medium-emphasis">
            {{ t("about.app_name") || "AiFetchly" }}
          </v-col>
          <v-col cols="12" sm="9" class="text-body-1">
            {{ displayName || "AiFetchly" }}
          </v-col>
        </v-row>

        <v-row dense align="center">
          <v-col cols="12" sm="3" class="text-subtitle-2 text-medium-emphasis">
            {{ t("about.version") || "Version" }}
          </v-col>
          <v-col cols="12" sm="9" class="text-body-1">
            <v-chip v-if="appVersion" size="small" color="primary" label>
              v{{ appVersion }}
            </v-chip>
            <v-progress-circular
              v-else
              indeterminate
              size="20"
              width="2"
              color="primary"
            ></v-progress-circular>
          </v-col>
        </v-row>

        <v-row dense align="center" class="mb-2">
          <v-col cols="12" sm="3" class="text-subtitle-2 text-medium-emphasis">
            {{ t("about.website") || "Website" }}
          </v-col>
          <v-col cols="12" sm="9">
            <v-btn
              size="small"
              variant="outlined"
              color="primary"
              :loading="openingWebsite"
              @click="onOpenWebsite"
            >
              <v-icon left>mdi-open-in-new</v-icon>
              {{ websiteUrl }}
            </v-btn>
          </v-col>
        </v-row>

        <v-divider class="my-4"></v-divider>

        <!-- Updates -->
        <div class="d-flex align-center flex-wrap ga-3">
          <v-btn
            v-if="canCheckForUpdates"
            color="primary"
            :loading="updateStatus.state === 'checking'"
            :disabled="updateStatus.state === 'checking' || updateStatus.state === 'downloading'"
            @click="onCheckForUpdates"
          >
            <v-icon left>mdi-update</v-icon>
            {{ t("about.check_for_updates") || "Check for updates" }}
          </v-btn>

          <v-btn
            v-if="updateStatus.state === 'ready-to-restart'"
            color="success"
            @click="onInstallUpdate"
          >
            <v-icon left>mdi-restart</v-icon>
            {{ t("about.restart_to_install") || "Restart to Update" }}
          </v-btn>

          <span class="text-body-2" :class="statusColorClass">
            {{ statusText }}
          </span>
        </div>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="4000">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  getAppInfo,
  openWebsite,
  getUpdateStatus,
  checkForUpdates,
  installUpdate,
  onUpdateStatus,
  offUpdateStatus,
  type UpdateStatusListener,
} from "@/views/api/app";
import { AIFETCHLY_WEBSITE_URL } from "@/config/appInfo";
import type { UpdateStatusSnapshot } from "@/entityTypes/updateStatus-type";

const { t } = useI18n();
const router = useRouter();

const websiteUrl = AIFETCHLY_WEBSITE_URL;
const displayName = ref<string>("");
const appVersion = ref<string>("");
const openingWebsite = ref(false);

// Start from idle; replaced by the real snapshot on mount.
const updateStatus = ref<UpdateStatusSnapshot>({
  state: "idle",
  currentVersion: "",
});

let statusListener: UpdateStatusListener | null = null;

const snackbar = ref(false);
const snackbarText = ref("");
const snackbarColor = ref<"error" | "success" | "info">("error");

function showSnackbar(message: string, color: "error" | "success" | "info" = "error"): void {
  snackbarText.value = message;
  snackbarColor.value = color;
  snackbar.value = true;
}

/** Show the Check button except when unsupported or already ready-to-restart. */
const canCheckForUpdates = computed(
  () =>
    updateStatus.value.state !== "unsupported" &&
    updateStatus.value.state !== "ready-to-restart",
);

const statusText = computed<string>(() => {
  const state = updateStatus.value.state;
  switch (state) {
    case "checking":
      return t("about.status_checking") || "Checking for updates…";
    case "downloading":
      return t("about.status_downloading") || "Downloading update…";
    case "up-to-date":
      return (
        t("about.status_up_to_date", { version: appVersion.value }) ||
        `You're on the latest version (${appVersion.value}).`
      );
    case "ready-to-restart":
      return (
        t("about.status_ready_to_restart") ||
        "Update downloaded. Restart to apply."
      );
    case "error":
      return (
        t("about.status_error") ||
        "Could not check for updates. Try again later."
      );
    case "unsupported": {
      const reason = updateStatus.value.unsupportedReason;
      if (reason === "store") {
        return (
          t("about.unsupported_store") ||
          "Updates are managed by Microsoft Store."
        );
      }
      if (reason === "platform") {
        return (
          t("about.unsupported_platform") ||
          "Automatic updates are not supported on this platform."
        );
      }
      return (
        t("about.unsupported_development") ||
        "Update checks are unavailable in development builds."
      );
    }
    case "idle":
    default:
      return t("about.status_idle") || "Click to check for the latest version.";
  }
});

const statusColorClass = computed<string>(() => {
  const state = updateStatus.value.state;
  if (state === "error") return "text-error";
  if (state === "up-to-date" || state === "ready-to-restart") return "text-success";
  if (state === "unsupported") return "text-medium-emphasis";
  return "text-medium-emphasis";
});

function applySnapshot(snapshot: UpdateStatusSnapshot): void {
  updateStatus.value = snapshot;
  if (snapshot.currentVersion && !appVersion.value) {
    appVersion.value = snapshot.currentVersion;
  }
}

async function onOpenWebsite(): Promise<void> {
  openingWebsite.value = true;
  try {
    await openWebsite();
  } catch (err) {
    // Don't surface the raw backend code (e.g. OPEN_WEBSITE_FAILED); use i18n.
    console.error("Failed to open website:", err);
    showSnackbar(
      t("about.open_website_failed") || "Could not open the website. Try again later.",
    );
  } finally {
    openingWebsite.value = false;
  }
}

async function onCheckForUpdates(): Promise<void> {
  const prevState = updateStatus.value.state;
  try {
    const snapshot = await checkForUpdates();
    // If the state did not change, the main-process cooldown rejected the
    // request — tell the user instead of looking like a dead button (PRD FR-4.4).
    if (snapshot.state === prevState) {
      showSnackbar(
        t("about.cooldown_active") ||
          "Checked recently. Please wait a minute before trying again.",
        "info",
      );
    }
    applySnapshot(snapshot);
  } catch (err) {
    console.error("Failed to check for updates:", err);
    showSnackbar(
      t("about.status_error") || "Could not check for updates. Try again later.",
    );
  }
}

async function onInstallUpdate(): Promise<void> {
  try {
    await installUpdate();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    showSnackbar(detail || "Failed to install update.");
  }
}

function goBack(): void {
  router.push({ name: "system_setting_index" });
}

onMounted(async () => {
  try {
    const info = await getAppInfo();
    displayName.value = info.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    appVersion.value = info.version;
  } catch (err) {
    console.error("Failed to load app info:", err);
  }

  try {
    applySnapshot(await getUpdateStatus());
  } catch (err) {
    console.error("Failed to load update status:", err);
  }

  statusListener = onUpdateStatus(applySnapshot);
});

onBeforeUnmount(() => {
  // Remove only this page's listener. A global removeAllListeners() would
  // silently kill any other future consumer of the same channel.
  if (statusListener) {
    offUpdateStatus(statusListener);
    statusListener = null;
  }
});
</script>
