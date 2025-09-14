<template>
    <div class="tables_page">
        <!-- Add create task button -->
        <div class="search_bar mt-4 d-flex jsb">
            <div class="d-flex jsb search_tool">
                <div class="search_wrap mr-4">
                    <v-text-field rounded class="elevation-0" density="compact" variant="solo" :label="t('home.search_tasks')"
                        append-inner-icon="mdi-magnify" single-line hide-details></v-text-field>
                </div>
                <div class="ml-auto">
                    <v-btn class="btn mb-4" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createTask()">
                        {{ t('route.create_search_task') }}
                    </v-btn>
                </div>
            </div>
        </div>
       
        <SearchresultTable />
    </div>
</template>
<script setup lang="ts">

import { ref } from 'vue';
import SearchresultTable from '@/views/pages/search/widgets/SearchResultTable.vue'
import router from '@/views/router';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
//const dialog = ref(false);

// onMounted(() => {
    
// });

const createTask = () => {
    console.log("create search task")
    router.push({
        name: 'Searchform'
    });
}

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
