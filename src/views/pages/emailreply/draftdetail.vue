<template>
  <v-sheet class="mx-auto pa-4" rounded>
    <div class="d-flex align-center mb-4">
      <v-btn color="error" variant="text" @click="router.go(-1)">
        <v-icon start>mdi-arrow-left</v-icon>{{ t("common.return") }}
      </v-btn>
      <h2 class="ml-2">{{ t("route.ai_reply_draft_detail") }}</h2>
    </div>

    <ReplyDraftReviewCard v-if="draftId !== null" :draft-id="draftId" />
  </v-sheet>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import ReplyDraftReviewCard from "@/views/pages/emailreply/widgets/ReplyDraftReviewCard.vue";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const draftId = computed(() => {
  const raw = route.params.id;
  const id = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
});
</script>
