<template>
  <AppPageShell
    page-id="insights-home"
    title-key="insights.title"
    description-key="insights.subtitle"
    content-width="full"
  >
    <div class="landing-section">
      <div
        v-for="item in insightItems"
        :key="item.path"
        class="landing-row"
        tabindex="0"
        role="button"
        :aria-label="item.title"
        @click="goTo(item.path)"
        @keydown.enter.prevent="goTo(item.path)"
        @keydown.space.prevent="goTo(item.path)"
      >
        <span class="row-icon" aria-hidden="true">
          <v-icon :icon="item.icon" size="22" />
        </span>
        <span class="row-title">{{ item.title }}</span>
        <span class="row-value">{{ item.description }}</span>
        <v-icon class="row-arrow" icon="mdi-arrow-right" size="20" aria-hidden="true" />
      </div>
    </div>
  </AppPageShell>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";

interface InsightItem {
  title: string;
  description: string;
  icon: string;
  path: string;
}

const router = useRouter();
const { t } = useI18n();

const insightItems = computed<InsightItem[]>(() => [
  {
    title: t("route.email_service") || "Email Service",
    description:
      t("insights.email_service_description") ||
      "Configure SMTP and IMAP email service connections.",
    icon: "mdi-email-sync",
    path: "/emailmarketing/emailservice/list",
  },
  {
    title: t("route.email_receive") || "Received Emails",
    description:
      t("insights.email_receive_description") ||
      "View and manage inbound emails received through configured services.",
    icon: "mdi-inbox-arrow-down",
    path: "/emailmarketing/emailreceive/list",
  },
  {
    title: t("route.ai_auto_replies") || "AI Auto Replies",
    description:
      t("insights.email_reply_description") ||
      "Review and audit AI-generated automatic email replies.",
    icon: "mdi-robot-outline",
    path: "/emailmarketing/emailreply/audit/list",
  },
  {
    title: t("route.proxy") || "Proxy",
    description:
      t("insights.proxy_description") ||
      "Manage and validate your proxy servers.",
    icon: "mdi-shield-outline",
    path: "/proxy/list",
  },
  {
    title: t("route.tool_account_list") || "Tool Account List",
    description:
      t("insights.tool_account_description") ||
      "Add, manage, and connect tool accounts for automation.",
    icon: "mdi-account-multiple",
    path: "/socialaccount/list",
  },
]);

function goTo(path: string): void {
  void router.push(path);
}
</script>

<style scoped>
.landing-section {
  max-width: var(--app-width-wide);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-panel);
  background: var(--app-surface);
  overflow: hidden;
}

.landing-row {
  display: flex;
  align-items: center;
  gap: var(--app-space-4);
  padding: var(--app-space-4) var(--app-space-5);
  border-bottom: 1px solid var(--app-border);
  cursor: pointer;
  transition: background-color var(--app-duration-short) ease;
}

.landing-row:last-child {
  border-bottom: none;
}

.landing-row:hover,
.landing-row:focus-visible {
  background: var(--app-surface-variant);
}

.landing-row:focus {
  outline: none;
}

.landing-row:focus-visible {
  outline: 2px solid var(--app-focus);
  outline-offset: -2px;
}

.row-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--app-radius-control);
  color: var(--app-accent);
  background: var(--app-accent-soft);
}

.row-title {
  flex-shrink: 0;
  min-width: 220px;
  color: var(--app-text);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.row-value {
  flex: 1;
  min-width: 0;
  color: var(--app-text-soft);
  font-size: 12.5px;
  line-height: 1.5;
}

.row-arrow {
  flex-shrink: 0;
  color: var(--app-text-muted);
  transition: color var(--app-duration-short) ease;
}

.landing-row:hover .row-arrow,
.landing-row:focus-visible .row-arrow {
  color: var(--app-accent);
}

@media (max-width: 700px) {
  .landing-row {
    flex-wrap: wrap;
    gap: var(--app-space-2);
    padding: var(--app-space-3) var(--app-space-4);
  }

  .row-title {
    min-width: 0;
  }

  .row-value {
    flex-basis: 100%;
    padding-left: calc(36px + var(--app-space-2));
  }
}
</style>
