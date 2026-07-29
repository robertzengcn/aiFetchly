<template>
  <v-container fluid class="insights-page">
    <header class="insights-page__header">
      <div>
        <h1 class="insights-page__title">
          {{ t("insights.title") || "Insights" }}
        </h1>
        <p class="insights-page__subtitle">
          {{
            t("insights.subtitle") ||
            "Review business signals, find prospects, and manage outreach from one workspace."
          }}
        </p>
      </div>
    </header>

    <div class="insights-page__grid">
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
        <div class="insight-card__icon">
          <v-icon :icon="item.icon" size="28" />
        </div>
        <div class="insight-card__content">
          <h2 class="insight-card__title">{{ item.title }}</h2>
          <p class="insight-card__description">{{ item.description }}</p>
        </div>
        <v-icon class="insight-card__arrow" icon="mdi-arrow-right" size="22" />
      </v-card>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

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
    title: t("route.statistic") || "Statistics",
    description:
      t("insights.statistics_description") ||
      "Track activity, trends, and campaign performance.",
    icon: "mdi-chart-box-outline",
    path: "/statistic",
  },
  {
    title: t("route.search") || "Market Insight",
    description:
      t("insights.market_description") ||
      "Research markets and find opportunities.",
    icon: "mdi-magnify",
    path: "/search/tasklist",
  },
  {
    title: t("insights.contact_profile") || "Contact Profile",
    description:
      t("insights.contact_description") ||
      "Extract and enrich contact profiles for prospects.",
    icon: "mdi-email-search",
    path: "/emailextraction/tasklist",
  },
  {
    title: t("route.map_scraper") || "Local Business Finder",
    description:
      t("insights.maps_description") ||
      "Find local businesses from map providers.",
    icon: "mdi-map-marker-multiple",
    path: "/map-scraper",
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
.insights-page {
  min-height: calc(100vh - 92px);
  padding: 32px;
  background: #f7f8fa;
}

.insights-page__header {
  max-width: 1120px;
  margin: 0 auto 24px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.insights-page__title {
  margin: 0;
  color: #172033;
  font-size: 32px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0;
}

.insights-page__subtitle {
  max-width: 620px;
  margin: 8px 0 0;
  color: #5f6b7a;
  font-size: 15px;
  line-height: 1.6;
}

.insights-page__grid {
  max-width: 1120px;
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
  border: 1px solid rgba(23, 32, 51, 0.08);
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.insight-card:hover,
.insight-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 10px 28px rgba(23, 32, 51, 0.1);
  transform: translateY(-1px);
  outline: none;
}

.insight-card__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}

.insight-card__content {
  min-width: 0;
}

.insight-card__title {
  margin: 0;
  color: #172033;
  font-size: 17px;
  line-height: 1.35;
  font-weight: 650;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.insight-card__description {
  margin: 8px 0 0;
  color: #667085;
  font-size: 13px;
  line-height: 1.55;
}

.insight-card__arrow {
  color: #7a8696;
  margin-top: 2px;
}

@media (max-width: 1100px) {
  .insights-page__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .insights-page {
    padding: 22px 16px;
  }

  .insights-page__header {
    margin-bottom: 18px;
  }

  .insights-page__title {
    font-size: 28px;
  }

  .insights-page__grid {
    grid-template-columns: 1fr;
  }

  .insight-card {
    min-height: 132px;
    padding: 16px;
  }
}
</style>

<style>
:root[theme="dark"] .insights-page {
  background: #121212;
}

:root[theme="dark"] .insights-page__title,
:root[theme="dark"] .insight-card__title {
  color: #f4f6f8;
}

:root[theme="dark"] .insights-page__subtitle,
:root[theme="dark"] .insight-card__description {
  color: #a8b0bb;
}

:root[theme="dark"] .insight-card {
  background: #1e1e1e;
  border-color: rgba(255, 255, 255, 0.1);
}
</style>
