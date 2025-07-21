<template>
    <div class="tables_page">
<ProxyTable />
    </div>
</template>
<script setup lang="ts">
// import router from '@/views/router';
import { ref, onMounted } from 'vue';
import ProxyTable from '@/views/pages/proxy/widgets/ProxyTable.vue'
const dialog = ref(false);

// onMounted(() => {
    
//});

</script>
<style lang="scss">
.tables_page {
    .tjjj {
        .tj_label {
            padding: 4px 8px;
            border-radius: 15px;
            background: rgba(244, 67, 54, 0.2);
            color: #f44336;
        }
        .v-chip {
            margin-inline-end: 0 !important;
        }
    }
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
                height: 21px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .sub_title {
                font-size: 12px;
            }
            .v-icon {
                font-size: 35px;
            }
        }
    }
}
.isMobile {
    .tables_page {
        .search_bar {
            display: block !important;
            .search_tool {
                margin-bottom: 16px;
                .search_wrap {
                    flex: 1;
                }
            }
        }
        .table {
            width: calc(100vw - 32px);
            overflow: hidden;
        }
    }
}
</style>
