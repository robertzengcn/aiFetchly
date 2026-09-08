<template>
  <!--
    Center route boundary (design §6.2): one child route in a stable scroll
    container, legacy/converged frame selection from the migration registry,
    and route-keyed inspector cleanup. Query-only navigation does NOT remount
    the host (the child page decides reload).
  -->
  <section
    ref="hostRegion"
    class="app-center-route-host"
    :aria-busy="routeLoading"
    tabindex="-1"
    data-testid="app-center-route-host"
  >
    <component :is="frameComponent">
      <RouterView v-slot="{ Component, route }">
        <template v-if="Component">
          <div
            v-if="routeLoading"
            class="route-loading"
            role="status"
            :aria-label="t('ui.state.loading') || 'Loading…'"
          >
            <v-icon icon="mdi-loading" size="20" aria-hidden="true" class="route-loading-spin" />
          </div>
          <component
            :is="Component"
            v-show="!routeLoading"
            :key="route.path"
          />
        </template>
      </RouterView>
    </component>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, ref, watch, type Component } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import LegacyPageFrame from "./LegacyPageFrame.vue";
import { findSurfaceByRouteName } from "@/views/router/uiMigrationRegistry";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { useInnerPageShellFlag } from "@/views/composables/useInnerPageShellFlag";

const route = useRoute();
const { t } = useI18n();
const inspector = useAppInspectorStore();
const shellFlag = useInnerPageShellFlag();

const routeLoading = ref(false);
let loadTimer: number | null = null;
const hostRegion = ref<HTMLElement | null>(null);

/**
 * Frame selection: a route whose surface is `converged` renders bare (its
 * page owns the AppPageShell); everything else renders through the safe
 * LegacyPageFrame while the shell flag is on.
 */
const frameComponent = computed<Component>(() => {
  const surface = route.name
    ? findSurfaceByRouteName(String(route.name))
    : undefined;
  const converged = surface?.state === "converged" && shellFlag.shellEnabled.value;
  const Frame = converged ? BareFrame : LegacyPageFrame;
  return Frame;
});

/** True until the route watcher's immediate (initial-mount) run completes. */
let initialRouteWatch = true;

/** Owner-route inspector cleanup (design §9.4). */
watch(
  () => route.name,
  (name) => {
    if (typeof name === "string") {
      inspector.onRouteChanged(String(route.path));
    }
    // Brief loading affordance keeps the shell interactive (IPR-044);
    // it never blocks navigation or remounts the shell.
    routeLoading.value = true;
    if (loadTimer !== null) window.clearTimeout(loadTimer);
    loadTimer = window.setTimeout(() => {
      routeLoading.value = false;
    }, 150);
    // Focus transfer (PRD §16.3/§19.1): after a center-route change, move
    // focus into the newly active center landmark so keyboard users are not
    // stranded on the navigation control they just left. The immediate
    // (initial-mount) run keeps the app's default focus, and the chat route
    // is excluded — the chat center surface owns focus there and moves it
    // into the composer (selection / New chat), which must not be raced by
    // this landmark focus.
    if (!initialRouteWatch && name !== "AI_Chat_Workspace") {
      void nextTick(() => hostRegion.value?.focus());
    }
    initialRouteWatch = false;
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (loadTimer !== null) window.clearTimeout(loadTimer);
});

/** Invisible frame for converged pages (they carry their own geometry). */
const BareFrame = defineComponent({
  name: "BareFrame",
  setup(_, { slots }) {
    return () => h("div", { class: "bare-frame" }, slots.default?.());
  },
});
</script>

<style scoped>
.app-center-route-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.bare-frame,
.app-center-route-host :deep(.bare-frame) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.route-loading {
  position: absolute;
  top: var(--app-space-2);
  right: var(--app-space-4);
  z-index: 5;
  color: var(--app-text-muted);
}

.route-loading-spin {
  animation: app-route-spin 1s linear infinite;
}

@keyframes app-route-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .route-loading-spin {
    animation: none;
  }
}
</style>
