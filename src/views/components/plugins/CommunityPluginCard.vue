<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  ctaFor,
  entryUnavailable,
  statusForCommunityEntry,
} from "@/views/utils/communityPluginCta";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

/**
 * Presentational Community plugin card (unified plugin page tech design §8).
 *
 * Receives an immutable Hub catalog entry and a busy flag, renders identity /
 * metadata / description / tags / status / action, and emits user intent
 * (install, manage, upgrade, signin). The card imports NO renderer API — it
 * is purely presentational and independently testable. Access decisions come
 * from `ctaFor(entry)`; this card grants nothing and stores no state.
 */

const props = defineProps<{
  entry: PluginCommunityEntry;
  /** True only while THIS card's Install call is in flight. */
  installing: boolean;
  /** True when any global install is in flight (disables other Install buttons). */
  installBusy?: boolean;
}>();

const emit = defineEmits<{
  install: [entry: PluginCommunityEntry];
  manage: [entry: PluginCommunityEntry];
  upgrade: [];
  signin: [];
}>();

const { t } = useI18n();

const cta = computed(() => ctaFor(props.entry));
const status = computed(() => statusForCommunityEntry(props.entry));
const unavailable = computed(() => entryUnavailable(props.entry));

/** At most three visible tags; remainder shown as a non-interactive +N chip. */
const VISIBLE_TAGS = 3;
const visibleTags = computed(() =>
  (props.entry.tags ?? []).slice(0, VISIBLE_TAGS)
);
const extraTagCount = computed(
  () => Math.max(0, (props.entry.tags ?? []).length - VISIBLE_TAGS)
);

const statusLabel = computed<string | null>(() => {
  switch (status.value?.key) {
    case "installed":
      return t("communityPlugins.statusInstalled") || "Installed";
    case "upgrade_required":
      return t("communityPlugins.statusUpgradeRequired") || "Upgrade required";
    case "signin_required":
      return t("communityPlugins.statusSignInRequired") || "Sign in required";
    case "coming_soon":
      return t("communityPlugins.statusComingSoon") || "Coming soon";
    case "unavailable":
      return t("communityPlugins.statusUnavailable") || "Unavailable";
    default:
      return null;
  }
});

const slug = computed(() => props.entry.slug);
</script>

<template>
  <v-card
    class="community-plugin-card d-flex flex-column"
    :class="{ 'community-plugin-card--unavailable': unavailable }"
    :data-testid="`community-plugin-card-${slug}`"
    min-height="240"
    height="100%"
  >
    <v-card-title
      class="community-plugin-card__header text-subtitle-1 font-weight-bold d-flex align-center"
    >
      <v-icon class="mr-2" aria-hidden="true">mdi-puzzle</v-icon>
      <span class="community-plugin-card__name flex-grow-1">{{ entry.displayName }}</span>
      <v-chip
        v-if="status && statusLabel"
        size="small"
        :color="status.color"
        variant="tonal"
        :data-testid="`community-plugin-status-${slug}`"
      >
        <v-icon start :icon="status.icon" aria-hidden="true" />
        {{ statusLabel }}
      </v-chip>
    </v-card-title>

    <v-card-subtitle
      v-if="entry.owner || entry.category"
      class="community-plugin-card__metadata"
    >
      <span v-if="entry.owner">{{ entry.owner }}</span>
      <span v-if="entry.owner && entry.category"> · </span>
      <span v-if="entry.category">{{ entry.category }}</span>
    </v-card-subtitle>

    <v-card-text class="community-plugin-card__body flex-grow-1">
      <!-- Full description retained as the accessible tooltip via title attr;
           visible copy is clamped to three lines (tech design §8.4). -->
      <div
        class="community-plugin-card__description text-body-2"
        :title="entry.description"
      >
        {{ entry.description }}
      </div>
      <div
        v-if="visibleTags.length > 0"
        class="mt-2 d-flex flex-wrap ga-1"
      >
        <v-chip
          v-for="tag in visibleTags"
          :key="tag"
          size="x-small"
          variant="tonal"
        >
          {{ tag }}
        </v-chip>
        <v-chip
          v-if="extraTagCount > 0"
          size="x-small"
          variant="text"
          :aria-label="t('communityPlugins.moreTagCount', { count: extraTagCount }) || `${extraTagCount} more tags`"
        >
          +{{ extraTagCount }}
        </v-chip>
      </div>
    </v-card-text>

    <v-card-actions class="community-plugin-card__footer align-center">
      <!-- allowed + direct + not installed -->
      <v-btn
        v-if="cta === 'install'"
        color="primary"
        variant="tonal"
        :loading="installing"
        :disabled="installBusy"
        :data-testid="`community-plugin-install-${slug}`"
        @click="emit('install', entry)"
      >
        {{ t("communityPlugins.install") || "Install" }}
      </v-btn>

      <!-- allowed + direct + installed -->
      <v-btn
        v-else-if="cta === 'installed'"
        color="success"
        variant="text"
        prepend-icon="mdi-cog-outline"
        :data-testid="`community-plugin-manage-${slug}`"
        @click="emit('manage', entry)"
      >
        {{ t("communityPlugins.manage") || "Manage" }}
      </v-btn>

      <!-- allowed + ticket: preview-only in Stage 1. The native title attr is
           an accessible tooltip that keeps the affordance testable without a
           Vuetify v-tooltip slot (unified plugin page PRD §9.6 / §16.11). -->
      <v-btn
        v-else-if="cta === 'preview'"
        disabled
        variant="tonal"
        prepend-icon="mdi-clock-outline"
        :title="t('communityPlugins.installFuture') || 'Installable in a future release.'"
        :data-testid="`community-plugin-preview-${slug}`"
      >
        {{ t("communityPlugins.preview") || "Preview" }}
      </v-btn>

      <!-- subscription_required -->
      <v-btn
        v-else-if="cta === 'upgrade'"
        color="secondary"
        variant="tonal"
        prepend-icon="mdi-arrow-up-bold-circle-outline"
        :data-testid="`community-plugin-upgrade-${slug}`"
        @click="emit('upgrade')"
      >
        {{ t("communityPlugins.upgrade") || "Upgrade" }}
      </v-btn>

      <!-- login_required -->
      <v-btn
        v-else-if="cta === 'signin'"
        variant="outlined"
        :data-testid="`community-plugin-signin-${slug}`"
        @click="emit('signin')"
      >
        {{ t("communityPlugins.signIn") || "Sign in" }}
      </v-btn>

      <!-- forbidden / unavailable: readable status text, no action -->
      <span
        v-else
        class="text-caption text-medium-emphasis"
        :data-testid="`community-plugin-unavailable-${slug}`"
      >
        {{ t("communityPlugins.statusUnavailable") || "Unavailable" }}
      </span>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.community-plugin-card {
  display: flex;
  flex-direction: column;
  min-height: 240px;
  height: 100%;
}

.community-plugin-card__body {
  flex: 1 1 auto;
}

.community-plugin-card__description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

/* Unavailable cards use a muted surface/border, never blanket opacity, so
   body text keeps WCAG AA contrast (unified plugin page PRD §9.6 / §16.7). */
.community-plugin-card--unavailable {
  background: rgb(var(--v-theme-surface-variant));
  border-color: rgb(var(--v-theme-outline));
}
</style>
