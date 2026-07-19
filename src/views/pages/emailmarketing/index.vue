<template>
  <v-container fluid class="outreach-page">
    <header class="outreach-page__header">
      <div>
        <h1 class="outreach-page__title">
          {{ t("route.email_marketing") || "Outreach Campaign" }}
        </h1>
        <p class="outreach-page__subtitle">
          {{
            t("outreach.subtitle") ||
            "Manage outreach tasks, templates, filters, email services, and replies."
          }}
        </p>
      </div>
    </header>

    <div class="outreach-page__grid">
      <v-card
        v-for="item in outreachItems"
        :key="item.path"
        class="outreach-card"
        elevation="0"
        tabindex="0"
        role="button"
        :aria-label="item.title"
        @click="goTo(item.path)"
        @keydown.enter.prevent="goTo(item.path)"
        @keydown.space.prevent="goTo(item.path)"
      >
        <div class="outreach-card__icon" :style="{ background: item.iconBg, color: item.iconColor }">
          <v-icon :icon="item.icon" size="28" />
        </div>
        <div class="outreach-card__content">
          <h2 class="outreach-card__title">{{ item.title }}</h2>
          <p class="outreach-card__description">{{ item.description }}</p>
        </div>
        <v-icon class="outreach-card__arrow" icon="mdi-arrow-right" size="22" />
      </v-card>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

interface OutreachItem {
  title: string;
  description: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  path: string;
}

const router = useRouter();
const { t } = useI18n();

const outreachItems = computed<OutreachItem[]>(() => [
  {
    title: t("route.bulk_email_task_list") || "Outreach Tasks",
    description:
      t("outreach.tasks_description") ||
      "Create and manage bulk email outreach tasks.",
    icon: "mdi-format-list-bulleted",
    iconBg: "rgba(88, 101, 242, 0.1)",
    iconColor: "#5865f2",
    path: "/emailmarketing/buckemailtask/list/",
  },
  {
    title: t("route.email_template") || "Email Templates",
    description:
      t("outreach.template_description") ||
      "Create and manage email templates for outreach campaigns.",
    icon: "mdi-file-document-edit",
    iconBg: "rgba(59, 130, 246, 0.1)",
    iconColor: "#3b82f6",
    path: "/emailmarketing/template/list/",
  },
  {
    title: t("route.email_service") || "Email Services",
    description:
      t("outreach.service_description") ||
      "Configure SMTP and IMAP email service connections.",
    icon: "mdi-email-sync",
    iconBg: "rgba(245, 158, 11, 0.1)",
    iconColor: "#f59e0b",
    path: "/emailmarketing/emailservice/list",
  },
  {
    title: t("outreach.received_messages") || "Received Messages",
    description:
      t("outreach.receive_description") ||
      "View and manage inbound emails received through configured services.",
    icon: "mdi-inbox-arrow-down",
    iconBg: "rgba(139, 92, 246, 0.1)",
    iconColor: "#8b5cf6",
    path: "/emailmarketing/emailreceive/list",
  },
  {
    title: t("outreach.reply_audit") || "Reply Audit",
    description:
      t("outreach.audit_description") ||
      "Review AI-generated replies, approval status, and audit logs.",
    icon: "mdi-clipboard-text-clock",
    iconBg: "rgba(239, 68, 68, 0.1)",
    iconColor: "#ef4444",
    path: "/emailmarketing/emailreply/audit/list",
  },
]);

function goTo(path: string): void {
  void router.push(path);
}
</script>

<style scoped>
.outreach-page {
  min-height: calc(100vh - 92px);
  padding: 32px;
  background: #f7f8fa;
}

.outreach-page__header {
  max-width: 1120px;
  margin: 0 auto 24px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.outreach-page__title {
  margin: 0;
  color: #172033;
  font-size: 32px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0;
}

.outreach-page__subtitle {
  max-width: 620px;
  margin: 8px 0 0;
  color: #5f6b7a;
  font-size: 15px;
  line-height: 1.6;
}

.outreach-page__grid {
  max-width: 1120px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.outreach-card {
  min-height: 156px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 24px;
  gap: 14px;
  align-items: start;
  padding: 20px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.outreach-card:hover,
.outreach-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 10px 28px rgba(23, 32, 51, 0.1);
  transform: translateY(-1px);
  outline: none;
}

.outreach-card__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.outreach-card__content {
  min-width: 0;
}

.outreach-card__title {
  margin: 0;
  color: #172033;
  font-size: 17px;
  line-height: 1.35;
  font-weight: 650;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.outreach-card__description {
  margin: 8px 0 0;
  color: #667085;
  font-size: 13px;
  line-height: 1.55;
}

.outreach-card__arrow {
  color: #7a8696;
  margin-top: 2px;
}

@media (max-width: 1100px) {
  .outreach-page__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .outreach-page {
    padding: 22px 16px;
  }

  .outreach-page__header {
    margin-bottom: 18px;
  }

  .outreach-page__title {
    font-size: 28px;
  }

  .outreach-page__grid {
    grid-template-columns: 1fr;
  }

  .outreach-card {
    min-height: 132px;
    padding: 16px;
  }
}
</style>

<style>
:root[theme="dark"] .outreach-page {
  background: #121212;
}

:root[theme="dark"] .outreach-page__title,
:root[theme="dark"] .outreach-card__title {
  color: #f4f6f8;
}

:root[theme="dark"] .outreach-page__subtitle,
:root[theme="dark"] .outreach-card__description {
  color: #a8b0bb;
}

:root[theme="dark"] .outreach-card {
  background: #1e1e1e;
  border-color: rgba(255, 255, 255, 0.1);
}
</style>
