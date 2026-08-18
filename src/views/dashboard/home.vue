<template>
  <v-container fluid class="agent-dashboard">
    <section class="agent-dashboard__content" :aria-label="translations.dashboard">
      <h1 class="agent-dashboard__headline">
        {{ translations.agentHeadline }}
      </h1>

      <form class="agent-dashboard__prompt" @submit.prevent="openAiChat">
        <v-textarea
          v-model="prompt"
          class="agent-dashboard__input"
          :placeholder="translations.agentPlaceholder"
          :aria-label="translations.agentInputAria"
          variant="outlined"
          rows="1"
          max-rows="4"
          auto-grow
          hide-details
          density="comfortable"
          @keydown="handlePromptKeydown"
        />
        <v-btn
          class="agent-dashboard__send"
          color="primary"
          icon="mdi-send"
          type="submit"
          :disabled="!canSubmit"
          :aria-label="translations.agentSendLabel"
        />
      </form>
    </section>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const prompt = ref("");

const translations = computed(() => ({
  dashboard: t("home.dashboard") || "Dashboard",
  agentHeadline:
    t("home.agent_headline") || "Your AI agent for business operations",
  agentPlaceholder:
    t("home.agent_placeholder") ||
    "Ask AI to find leads, write outreach, analyze campaigns...",
  agentInputAria:
    t("home.agent_input_aria") || "Ask the AI agent",
  agentSendLabel:
    t("home.agent_send_label") || "Open AI chat",
}));

const canSubmit = computed(() => prompt.value.trim().length > 0);

function openAiChat(): void {
  const text = prompt.value.trim();
  if (!text) return;

  window.dispatchEvent(
    new CustomEvent<{ prompt: string }>("aifetchly:open-ai-chat", {
      detail: { prompt: text },
    })
  );
  prompt.value = "";
}

function handlePromptKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  openAiChat();
}
</script>

<style scoped>
.agent-dashboard {
  min-height: calc(100vh - 92px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: #f7f8fa;
}

.agent-dashboard__content {
  width: min(760px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  text-align: center;
}

.agent-dashboard__headline {
  margin: 0;
  color: #172033;
  font-size: 56px;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: 0;
}

.agent-dashboard__prompt {
  width: min(680px, 100%);
  display: grid;
  grid-template-columns: 1fr 48px;
  align-items: end;
  gap: 10px;
}

.agent-dashboard__input {
  text-align: left;
}

.agent-dashboard__send {
  width: 48px;
  height: 48px;
}

@media (max-width: 600px) {
  .agent-dashboard {
    align-items: flex-start;
    padding: 64px 18px 24px;
  }

  .agent-dashboard__content {
    gap: 22px;
  }

  .agent-dashboard__headline {
    font-size: 34px;
  }

  .agent-dashboard__prompt {
    grid-template-columns: 1fr 44px;
  }

  .agent-dashboard__send {
    width: 44px;
    height: 44px;
  }
}
</style>

<style>
:root[theme="dark"] .agent-dashboard {
  background: #121212;
}

:root[theme="dark"] .agent-dashboard__headline {
  color: #f4f6f8;
}
</style>
