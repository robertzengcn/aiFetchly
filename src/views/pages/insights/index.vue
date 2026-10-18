<template>
  <AppPageShell
    page-id="insights-home"
    title-key="insights.title"
    description-key="insights.subtitle"
    content-width="full"
  >
    <div class="insights-grid">
      <v-card
        v-for="item in insightItems"
        :key="item.path"
        class="insight-card"
        elevation="0"
        tabindex="0"
        role="button"
        :aria-label="item.title"
        @click="goTo(item.path)"
        @keydown.enter.prevent="goTo(item.path)"
        @keydown.space.prevent="goTo(item.path)"
      >
        <div class="insight-card__icon" aria-hidden="true">
          <v-icon :icon="item.icon" size="28" />
        </div>
        <div class="insight-card__content">
          <h2 class="insight-card__title">{{ item.title }}</h2>
          <p class="insight-card__description">{{ item.description }}</p>
        </div>
        <v-icon class="insight-card__arrow" icon="mdi-arrow-right" size="22" aria-hidden="true" />
      </v-card>
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
.insights-grid {
  max-width: var(--app-width-wide);
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.insight-card {
  min-height: 156px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 24px;
  gap: 14px;
  align-items: start;
  padding: 20px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-panel);
  background: var(--app-surface);
  cursor: pointer;
  transition:
    border-color var(--app-duration-short) ease,
    box-shadow var(--app-duration-short) ease,
    transform var(--app-duration-short) ease;
}

.insight-card:hover,
.insight-card:focus-visible {
  border-color: var(--app-accent);
  box-shadow: 0 10px 28px rgba(23, 32, 51, 0.1);
  transform: translateY(-1px);
  outline: none;
}

.insight-card:focus-visible {
  outline: 2px solid var(--app-focus);
  outline-offset: -2px;
}

.insight-card__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--app-radius-control);
  color: var(--app-accent);
  background: var(--app-accent-soft);
}

.insight-card__content {
  min-width: 0;
  margin-top: 10px;
}

.insight-card__title {
  margin: 0;
  color: var(--app-text);
  font-size: 17px;
  line-height: 1.35;
  font-weight: 650;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.insight-card__description {
  margin: 8px 0 0;
  color: var(--app-text-soft);
  font-size: 13px;
  line-height: 1.55;
}

.insight-card__arrow {
  color: var(--app-text-muted);
  margin-top: 2px;
}

.insight-card:hover .insight-card__arrow,
.insight-card:focus-visible .insight-card__arrow {
  color: var(--app-accent);
}

@media (max-width: 1100px) {
  .insights-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .insights-grid {
    grid-template-columns: 1fr;
  }

  .insight-card {
    min-height: 132px;
    padding: 16px;
  }
}
</style>
