<template>
  <div class="tables_page">
    <AutoReplyAuditTable />
  </div>
</template>
<script setup lang="ts">
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
