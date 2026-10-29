<template>
  <AppPageShell
    page-id="reply-audit-list"
    title-key="route.ai_auto_replies"
    content-width="full"
  >
    <AutoReplyAuditTable />
  </AppPageShell>
</template>
<script setup lang="ts">
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import AutoReplyAuditTable from "@/views/pages/emailreply/widgets/AutoReplyAuditTable.vue";
</script>
<style lang="scss">
.tables_page {
  .search_bar {
    .search_tool {
      .search_wrap {
        flex: 0 0 260px;
      }
      .btn {
        height: 40px;
      }
    }
    .v-field--variant-solo {
      box-shadow: none;
    }
  }
  .table {
    .td1 {
      .name {
        font-weight: 700;
      }
    }
  }
}
</style>
