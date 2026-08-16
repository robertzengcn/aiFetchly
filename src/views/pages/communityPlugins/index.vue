<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  installCommunityPlugin,
  listCommunityPlugins,
  openCommunityPlansPage,
} from "@/views/api/communityPlugins";
import { getLoginUrl } from "@/views/api/users";
import { windowReceive, windowRemoveListener } from "@/views/utils/apirequest";
import { WEBSOCKET_EVENT } from "@/config/channellist";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

/**
 * Community Plugins page (Community Plugin Page PRD §7.7).
 *
 * Thin consumer of the PLUGIN_COMMUNITY_* IPC channels. The Hub decides
 * which rows each viewer sees (per-row access.status / installMode); this
 * page never classifies free-vs-paid itself and never receives plan data.
 */

const { t } = useI18n();

const loading = ref(true);
const entries = ref<PluginCommunityEntry[]>([]);
const errorMessage = ref<string | null>(null);
const installError = ref<string | null>(null);
const installBusySlug = ref<string | null>(null);

/** Auth-shaped failures get a dedicated "Sign in again" affordance. */
const sessionExpired = computed(() => {
  const msg = (errorMessage.value ?? "").toLowerCase();
  return (
    msg.includes("authentication failed") || msg.includes("refresh token")
  );
});

async function load(force = false): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  installError.value = null;
  try {
    const data = await listCommunityPlugins({ forceRefresh: force });
    entries.value = data ?? [];
  } catch (e: unknown) {
    errorMessage.value =
      e instanceof Error ? e.message : String(e || "Failed to load plugins.");
  } finally {
    loading.value = false;
  }
}

async function onInstall(entry: PluginCommunityEntry): Promise<void> {
  if (installBusySlug.value) return;
  installBusySlug.value = entry.slug;
  installError.value = null;
  try {
    await installCommunityPlugin(entry.slug);
    // Immutable update: flip only the installed row.
    entries.value = entries.value.map((e) =>
      e.slug === entry.slug ? { ...e, installed: true } : e
    );
  } catch (e: unknown) {
    installError.value =
      e instanceof Error ? e.message : String(e || "Install failed.");
  } finally {
    installBusySlug.value = null;
  }
}

/** Upgrade CTA — opens the marketing plans page via main (constant URL). */
async function onUpgrade(): Promise<void> {
  try {
    await openCommunityPlansPage();
  } catch (e: unknown) {
    installError.value =
      e instanceof Error ? e.message : String(e || "Could not open plans.");
  }
}

/** Sign-in CTA — the GET_LOGIN_URL handler opens the login page externally. */
async function onSignIn(): Promise<void> {
  try {
    await getLoginUrl();
  } catch (e: unknown) {
    installError.value =
      e instanceof Error ? e.message : String(e || "Could not open login.");
  }
}

type CardCta =
  | "install"
  | "installed"
  | "preview"
  | "upgrade"
  | "signin"
  | "none";

/** CTA matrix — driven entirely by the Hub's access decision (PRD §7.7). */
function ctaFor(entry: PluginCommunityEntry): CardCta {
  switch (entry.access.status) {
    case "allowed":
      if (entry.access.installMode === "direct") {
        return entry.installed ? "installed" : "install";
      }
      return "preview"; // allowed + ticket: preview-only in Stage 1
    case "subscription_required":
      return "upgrade";
    case "login_required":
      return "signin";
    default:
      return "none"; // forbidden / unavailable — greyed out
  }
}

function entryUnavailable(entry: PluginCommunityEntry): boolean {
  return entry.access.status === "forbidden" || entry.access.status === "unavailable";
}

/**
 * Live re-fetch on plan change: WebSocketClient broadcasts user_info_updated
 * (nested in WEBSOCKET_EVENT) after refreshUserInfoOnSubscriptionChange.
 * A user who upgrades mid-session sees the expanded catalog within seconds
 * (PRD §7.8).
 */
function onWebSocketEvent(event: unknown): void {
  const evt = event as { type?: string; data?: { type?: string } } | null;
  if (evt?.type === "message" && evt.data?.type === "user_info_updated") {
    void load(true);
  }
}

onMounted(() => {
  void load();
  windowReceive(WEBSOCKET_EVENT, onWebSocketEvent);
});

onUnmounted(() => {
  windowRemoveListener(WEBSOCKET_EVENT, onWebSocketEvent);
});
</script>

<template>
  <v-container fluid class="community-plugins-page">
    <v-row class="align-center mb-4" no-gutters>
      <v-col cols="12" sm="auto">
        <h1 class="text-h5">
          {{ t("communityPlugins.title") || "Community Plugins" }}
        </h1>
      </v-col>
      <v-spacer />
      <v-col cols="auto">
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-refresh"
          :loading="loading"
          data-testid="community-plugins-refresh"
          @click="load(true)"
        >
          {{ t("communityPlugins.refresh") || "Refresh" }}
        </v-btn>
      </v-col>
    </v-row>

    <v-alert
      v-if="errorMessage && sessionExpired"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="community-plugins-session-expired"
    >
      {{ t("communityPlugins.sessionExpired") || "Your session expired" }}
      <template #append>
        <v-btn color="warning" variant="tonal" @click="onSignIn">
          {{ t("communityPlugins.signInAgain") || "Sign in again" }}
        </v-btn>
      </template>
    </v-alert>

    <v-alert
      v-else-if="errorMessage"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="community-plugins-error"
    >
      {{ t("communityPlugins.error") || "Couldn't reach the Plugin Hub" }}
      <template #append>
        <v-btn color="error" variant="tonal" @click="load(true)">
          {{ t("communityPlugins.retry") || "Retry" }}
        </v-btn>
      </template>
    </v-alert>

    <v-alert
      v-if="installError"
      type="error"
      density="compact"
      variant="outlined"
      class="mb-4"
      closable
      data-testid="community-plugins-install-error"
    >
      {{ t("communityPlugins.installFailed") || "Install failed" }}:
      {{ installError }}
    </v-alert>

    <v-row v-if="loading" data-testid="community-plugins-loading">
      <v-col v-for="i in 6" :key="i" cols="12" sm="6" md="4">
        <v-skeleton-loader type="article" />
      </v-col>
    </v-row>

    <v-row v-else-if="entries.length === 0 && !errorMessage">
      <v-col cols="12" class="text-center py-10">
        <v-icon size="48" class="mb-2">mdi-store-search-outline</v-icon>
        <div class="text-body-1">
          {{ t("communityPlugins.empty") || "No plugins available" }}
        </div>
        <v-btn class="mt-3" variant="tonal" @click="load(true)">
          {{ t("communityPlugins.refresh") || "Refresh" }}
        </v-btn>
      </v-col>
    </v-row>

    <v-row v-else>
      <v-col
        v-for="entry in entries"
        :key="entry.slug"
        cols="12"
        sm="6"
        md="4"
      >
        <v-card
          class="fill-height d-flex flex-column"
          :class="{ 'community-plugin-unavailable': entryUnavailable(entry) }"
          :data-testid="`community-plugin-card-${entry.slug}`"
        >
          <v-card-title class="text-subtitle-1 font-weight-bold">
            {{ entry.displayName }}
          </v-card-title>
          <v-card-subtitle v-if="entry.owner || entry.category">
            <span v-if="entry.owner">{{ entry.owner }}</span>
            <span v-if="entry.owner && entry.category"> · </span>
            <span v-if="entry.category">{{ entry.category }}</span>
          </v-card-subtitle>
          <v-card-text class="flex-grow-1">
            {{ entry.description }}
            <div v-if="entry.tags && entry.tags.length > 0" class="mt-2">
              <v-chip
                v-for="tag in entry.tags"
                :key="tag"
                size="x-small"
                class="mr-1"
                :disabled="entryUnavailable(entry)"
              >
                {{ tag }}
              </v-chip>
            </div>
          </v-card-text>
          <v-card-actions>
            <!-- allowed + direct + not installed -->
            <v-btn
              v-if="ctaFor(entry) === 'install'"
              color="primary"
              :loading="installBusySlug === entry.slug"
              :data-testid="`community-plugin-install-${entry.slug}`"
              @click="onInstall(entry)"
            >
              {{ t("communityPlugins.install") || "Install" }}
            </v-btn>

            <!-- allowed + direct + installed -->
            <v-btn
              v-else-if="ctaFor(entry) === 'installed'"
              disabled
              variant="tonal"
              prepend-icon="mdi-check"
              :data-testid="`community-plugin-installed-${entry.slug}`"
            >
              {{ t("communityPlugins.installed") || "Installed" }}
            </v-btn>

            <!-- allowed + ticket: preview-only in Stage 1 -->
            <v-tooltip
              v-else-if="ctaFor(entry) === 'preview'"
              location="top"
            >
              <template #activator="{ props }">
                <span v-bind="props">
                  <v-btn disabled variant="tonal">
                    {{
                      t("communityPlugins.preview") || "Preview"
                    }}
                  </v-btn>
                </span>
              </template>
              {{
                t("communityPlugins.installFuture") ||
                  "Installable in a future release."
              }}
            </v-tooltip>

            <!-- subscription_required -->
            <v-btn
              v-else-if="ctaFor(entry) === 'upgrade'"
              color="secondary"
              prepend-icon="mdi-arrow-up-bold-circle-outline"
              :data-testid="`community-plugin-upgrade-${entry.slug}`"
              @click="onUpgrade"
            >
              {{ t("communityPlugins.upgrade") || "Upgrade" }}
            </v-btn>

            <!-- login_required -->
            <v-btn
              v-else-if="ctaFor(entry) === 'signin'"
              variant="outlined"
              @click="onSignIn"
            >
              {{ t("communityPlugins.signIn") || "Sign in" }}
            </v-btn>

            <!-- forbidden / unavailable: greyed out, no action -->
            <v-btn v-else disabled variant="text">&nbsp;</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.community-plugin-unavailable {
  opacity: 0.55;
}
</style>
