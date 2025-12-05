<template>
    <div class="search_bar mt-4 d-flex jsb mb-4">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" :label="t('common.search') || 'Search'"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"
                    @keyup.enter="handleSearch" @click:append-inner="handleSearch"></v-text-field>
            </div>
            <!-- <v-btn class="btn mr-2" variant="flat" prepend-icon="mdi-filter-variant"><span> {{t('common.more')}}</span></v-btn> -->
            <v-btn class="btn mr-2" variant="flat" color="info" prepend-icon="mdi-robot" @click="handleAiAnalyze" :disabled="selectedCount === 0" :loading="analyzing">
                <span>{{t('websiteAnalysis.analyze_button') || 'AI Analyze'}} {{ selectedCount > 0 ? `(${selectedCount})` : '' }}</span>
            </v-btn>
            <v-btn class="btn mr-2" variant="flat" color="success" prepend-icon="mdi-email-search" @click="handleScrapeEmail" :disabled="selectedCount === 0">
                <span>{{ buttonText }}</span>
            </v-btn>
            <v-btn class="btn" variant="flat" color="primary" prepend-icon="mdi-download" @click="handleExport" :loading="exporting">
                <span>{{t('common.export')}}</span>
            </v-btn>
        </div>     
    </div>
    <div class="table-scroll-container">
        <v-data-table-server v-model:items-per-page="itemsPerPage" v-model="selectedItems" 
            :search="search" :headers="headers" :items-length="totalItems" :items="serverItems" 
            :loading="loading" :item-value="getItemValue" show-select @update:options="loadItems" class="custom-data-table mt5">
            <template v-slot:[`item.link`]="{ item }">
                <div class="link-cell-container">
                    <v-tooltip location="top" :text="item.link">
                        <template v-slot:activator="{ props }">
                            <a :href="item.link" target="_blank" rel="noopener noreferrer" v-bind="props" class="link-cell">
                                {{ truncateLink(item.link) }}
                            </a>
                        </template>
                    </v-tooltip>
                    <v-tooltip location="top" text="Copy link">
                        <template v-slot:activator="{ props }">
                            <v-btn
                                icon
                                size="small"
                                variant="text"
                                density="compact"
                                v-bind="props"
                                @click="copyLink(item.link)"
                                class="copy-btn"
                            >
                                <v-icon size="small">mdi-content-copy</v-icon>
                            </v-btn>
                        </template>
                    </v-tooltip>
                </div>
            </template>
            <template v-slot:[`item.ai_industry`]="{ item }">
                <div class="ai-industry-cell">
                    <v-chip v-if="item.ai_industry" size="small" color="primary" variant="outlined">
                        {{ item.ai_industry }}
                    </v-chip>
                    <span v-else class="text-grey">-</span>
                </div>
            </template>
            <template v-slot:[`item.ai_match_score`]="{ item }">
                <div class="ai-match-score-cell">
                    <v-chip 
                        v-if="item.ai_match_score !== null && item.ai_match_score !== undefined" 
                        size="small" 
                        :color="getMatchScoreColor(item.ai_match_score)"
                        variant="flat"
                    >
                        {{ item.ai_match_score }}%
                    </v-chip>
                    <span v-else class="text-grey">-</span>
                </div>
            </template>
        </v-data-table-server>
    </div>
    
    <!-- Website Analysis Dialog -->
    <WebsiteAnalysisDialog
        :showDialog="showAnalysisDialog"
        :loading="analyzing"
        :itemCount="selectedResultsForAnalysis.length"
        :progress="analysisProgress"
        @dialogclose="closeAnalysisDialog"
        @analyze="handleAnalyzeConfirm"
    />
</template>

<script setup lang="ts">
import {useI18n} from "vue-i18n";
import { gettaskresult, exportSearchResults } from '@/views/api/search'
import { ref,computed,onMounted,watch } from 'vue'
import { SearchResult } from '@/views/api/types'
import {SearchResEntityDisplay} from "@/entityTypes/scrapeType"
import router from '@/views/router';
import { useRoute } from "vue-router";
import { SearchResultFetchparam } from "@/entityTypes/searchControlType"
import {CapitalizeFirstLetter} from "@/views/utils/function"
import WebsiteAnalysisDialog from '@/views/components/widgets/websiteAnalysisDialog.vue'
import { windowInvoke, windowReceive } from '@/views/utils/apirequest'
import { ANALYZE_WEBSITE, ANALYZE_WEBSITE_PROGRESS } from '@/config/channellist'

const $route = useRoute();
const {t} = useI18n({inheritLocale: true});
const taskid = parseInt($route.params.id.toString());

const initialize = async () => {
console.log($route.params.id)
//   if ($route.params.id) {
//     taskid.value = parseInt($route.params.id.toString());
//   }
}
onMounted(() => {
  initialize();
});
// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy: string,
    taskId: number,
    search: string
}

const FakeAPI = {

    async fetch(fetchparam: Fetchparam): Promise<SearchResult<SearchResEntityDisplay>> {
        console.log(fetchparam)
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        const param:SearchResultFetchparam={
            page: fpage,
            itemsPerPage: fetchparam.itemsPerPage,
            sortBy: fetchparam.sortBy,
            search: fetchparam.search,
            taskId:fetchparam.taskId
        }
        return await gettaskresult(param)
       
    }
}

const headers=ref<Array<any>>([])
headers.value = [
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.id"))),
        align: 'start',
        sortable: false,
        key: 'index',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.title"))),
        align: 'start',
        sortable: false,
        key: 'title',
        width: '20px'
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.link"))),
        align: 'start',
        sortable: false,
        key: 'link',
        width: '300px',
        minWidth: '250px',
        maxWidth: '400px'
        // value: computed(value => value.join(', '))
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.keyword"))),
        align: 'start',
        sortable: false,
        key: 'keyword',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.record_time"))),
        align: 'start',
        sortable: false,
        key: 'record_time',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("websiteAnalysis.customer_industry") || 'Customer Industry')),
        align: 'start',
        sortable: false,
        key: 'ai_industry',
        width: '200px',
        minWidth: '150px',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("websiteAnalysis.probability") || 'Probability of Potential Customers')),
        align: 'start',
        sortable: false,
        key: 'ai_match_score',
        width: '180px',
        minWidth: '150px',
    },
];
const itemsPerPage = ref(10);
const serverItems = ref<Array<SearchResEntityDisplay>>([]);
// When using item-value function, selectedItems stores the VALUES, not objects
const selectedItems = ref<Array<string | number>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
const exporting = ref(false);
const analyzing = ref(false);
const showAnalysisDialog = ref(false);
const selectedResultsForAnalysis = ref<SearchResEntityDisplay[]>([]);
const currentPage = ref(1);
const analysisProgress = ref({ current: 0, total: 0 });

/**
 * Get color for match score chip based on score value
 * @param score - The match score (0-100)
 * @returns Color name for the chip
 */
function getMatchScoreColor(score: number): string {
    if (score >= 80) {
        return 'success'; // Green for high scores
    } else if (score >= 60) {
        return 'info'; // Blue for medium-high scores
    } else if (score >= 40) {
        return 'warning'; // Orange for medium scores
    } else {
        return 'error'; // Red for low scores
    }
}

/**
 * Get unique value for table item (for selection)
 * Returns a unique identifier for each item
 */
function getItemValue(item: SearchResEntityDisplay): string | number {
    // Use id if available (most reliable)
    if (item.id !== undefined && item.id !== null) {
        return item.id;
    }
    // Fallback: use composite key with link and index
    // This ensures uniqueness even if id is missing
    const index = item.index !== undefined ? item.index : 0;
    return `${item.link}_${index}`;
}

/**
 * Computed property for selected items count
 */
const selectedCount = computed(() => {
    return selectedItems.value.length;
});

/**
 * Computed property for button text
 */
const buttonText = computed(() => {
    const baseText = t('emailextraction.extract_emails') || 'Extract Emails';
    const count = selectedItems.value.length;
    if (count > 0) {
        return `${baseText} (${count})`;
    }
    return baseText;
});

// Watch selectedItems to debug
watch(selectedItems, (newVal) => {
    console.log('Selected items changed:', newVal);
    console.log('Selected count:', newVal.length);
}, { deep: true });

// Debounce search to avoid too many API calls
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    searchTimeout = setTimeout(() => {
        // Reset to first page when search changes
        currentPage.value = 1;
        // Trigger reload by calling loadItems with current options
        if (taskid) {
            loadItems({ 
                page: 1, 
                itemsPerPage: itemsPerPage.value, 
                sortBy: '' 
            });
        }
    }, 500); // 500ms debounce
});

function loadItems({ page, itemsPerPage, sortBy }) {
    currentPage.value = page;
    loading.value = true
    //console.log(taskid)
    if(!taskid){
        return
    }
    // console.log(page);
    const fetchitem: Fetchparam = {
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        taskId:taskid,
        search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
             console.log(data)
            // console.log(total)
            // Ensure each item has a unique identifier and index
            data.forEach((item, index) => {
                item.index = (fetchitem.page - 1) * fetchitem.itemsPerPage + index + 1;
                // If item doesn't have an id, we'll use the composite key in getItemValue
            })
        
            serverItems.value = data
            totalItems.value = total
            // Clear selected items when data changes (new page or search)
            selectedItems.value = []
            loading.value = false
        }).catch(function (error) {
            console.error(error);
            loading.value = false
        })
}

function handleSearch() {
    // Reset to first page and reload
    currentPage.value = 1;
    if (taskid) {
        loadItems({ 
            page: 1, 
            itemsPerPage: itemsPerPage.value, 
            sortBy: '' 
        });
    }
}

async function handleExport() {
    if (!taskid) {
        return;
    }
    console.log(taskid)
    exporting.value = true;
    try {
        // Export as CSV by default (can be extended to support format selection)
        const filePath = await exportSearchResults(taskid, 'csv');
        if (filePath) {
            // Show success message (you might want to use a toast/snackbar component)
            console.log(`Export successful: ${filePath}`);
        }
    } catch (error) {
        console.error('Export failed:', error);
        // Show error message (you might want to use a toast/snackbar component)
        alert(error instanceof Error ? error.message : 'Export failed');
    } finally {
        exporting.value = false;
    }
}

/**
 * Navigate to email extraction page with URLs from selected search results
 */
function handleScrapeEmail() {
    if (selectedItems.value.length === 0) {
        alert('Please select at least one item to extract emails from');
        return;
    }
    
    console.log('Selected items (values):', selectedItems.value);
    
    // selectedItems contains VALUES (ids or composite keys), not objects
    // We need to find the actual items from serverItems
    const selectedItemValues = new Set(selectedItems.value);
    const actualSelectedItems = serverItems.value.filter(item => {
        const itemValue = getItemValue(item);
        return selectedItemValues.has(itemValue);
    });
    
    console.log('Actual selected items:', actualSelectedItems);
    
    // Collect all unique URLs from selected items
    const urlSet = new Set<string>();
    actualSelectedItems.forEach(item => {
        if (item.link && item.link.trim()) {
            urlSet.add(item.link.trim());
        }
    });
    
    const urls = Array.from(urlSet);
    
    if (urls.length === 0) {
        alert('No valid URLs found in selected items');
        return;
    }
    
    console.log('URLs to scrape:', urls);
    
    // Navigate to email extraction form with URLs as query parameter
    // Using a single 'urls' query param with newline-separated URLs
    const urlsParam = urls.join('\n');
    
    router.push({
        name: 'Email_Extraction_Form',
        query: {
            urls: urlsParam
        }
    });
}

/**
 * Truncate link to a maximum length with ellipsis
 */
function truncateLink(link: string, maxLength: number = 50): string {
    if (!link) return '';
    if (link.length <= maxLength) return link;
    return link.substring(0, maxLength) + '...';
}

/**
 * Copy link to clipboard
 */
async function copyLink(link: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(link);
        // You could show a toast notification here if available
        console.log('Link copied to clipboard:', link);
    } catch (error) {
        console.error('Failed to copy link:', error);
        // Fallback for older browsers
        try {
            const textArea = document.createElement('textarea');
            textArea.value = link;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            console.log('Link copied to clipboard (fallback):', link);
        } catch (fallbackError) {
            console.error('Fallback copy failed:', fallbackError);
            alert('Failed to copy link to clipboard');
        }
    }
}

/**
 * Handle AI Analyze button click
 */
function handleAiAnalyze(): void {
    if (selectedItems.value.length === 0) {
        alert('Please select at least one item to analyze');
        return;
    }

    // Find all selected items
    const selectedItemValues = new Set(selectedItems.value);
    const selectedItemsList = serverItems.value.filter(item => {
        const itemValue = getItemValue(item);
        return selectedItemValues.has(itemValue);
    });

    // Filter out items without valid URLs
    const validItems = selectedItemsList.filter(item => item.link && item.link.trim());

    if (validItems.length === 0) {
        alert('Selected items do not have valid URLs');
        return;
    }

    if (validItems.length < selectedItemsList.length) {
        alert(`Warning: ${selectedItemsList.length - validItems.length} selected item(s) do not have valid URLs and will be skipped.`);
    }

    selectedResultsForAnalysis.value = validItems;
    showAnalysisDialog.value = true;
}

/**
 * Close analysis dialog
 */
function closeAnalysisDialog(): void {
    if (!analyzing.value) {
        showAnalysisDialog.value = false;
        selectedResultsForAnalysis.value = [];
        analysisProgress.value = { current: 0, total: 0 };
    }
}

/**
 * Handle analyze confirmation from dialog
 */
async function handleAnalyzeConfirm(data: { businessInfo: string; temperature: number; saveForFuture: boolean }): Promise<void> {
    if (selectedResultsForAnalysis.value.length === 0) {
        return;
    }

    analyzing.value = true;
    analysisProgress.value = { current: 0, total: selectedResultsForAnalysis.value.length };

    // Filter valid items
    const validItems = selectedResultsForAnalysis.value.filter(item => item && item.link && item.id);
    
    if (validItems.length === 0) {
        alert('No valid items to analyze');
        analyzing.value = false;
        return;
    }

    let currentBatchId: string | null = null;
    const resultsMap = new Map<number, { success: boolean; data?: any; error?: string }>();

    try {
        // Set up progress listener
        const progressHandler = (event: unknown) => {
            try {
                // windowReceive passes the event object, extract data from it
                const eventData = event as { data?: string } | string;
                const progressData = typeof eventData === 'string' ? eventData : (eventData.data || '');
                if (!progressData) return;
                
                const progress = JSON.parse(progressData);
                if (progress.batchId === currentBatchId) {
                    analysisProgress.value = {
                        current: progress.completed || 0,
                        total: progress.total || validItems.length
                    };
                }
            } catch (error) {
                console.error('Error parsing progress data:', error);
            }
        };

        windowReceive(ANALYZE_WEBSITE_PROGRESS, progressHandler);

        // Prepare batch request
        const batchRequest = {
            items: validItems.map(item => ({
                resultId: item.id,
                url: item.link
            })),
            clientBusiness: data.businessInfo,
            temperature: data.temperature
        };

        // Send batch request
        const response = await windowInvoke(ANALYZE_WEBSITE, batchRequest);

        if (!response || !response.status || !response.data) {
            throw new Error(response?.msg || 'Failed to start batch analysis');
        }

        currentBatchId = response.data.batchId;
        const total = response.data.total;

        // Wait for all results (polling approach since we can't easily get completion callback)
        // In a real implementation, you might want to use a completion event
        // For now, we'll wait a reasonable time and then refresh the data
        await new Promise(resolve => setTimeout(resolve, Math.max(5000, total * 2000)));

        // Reload items to get updated analysis results
        if (taskid) {
            loadItems({ 
                page: currentPage.value, 
                itemsPerPage: itemsPerPage.value, 
                sortBy: '' 
            });
        }

        // Show success message
        alert(t('websiteAnalysis.analysis_success') || `Analysis started for ${total} item(s). Results will be updated automatically.`);
        
        // Close dialog
        showAnalysisDialog.value = false;
        selectedResultsForAnalysis.value = [];
        analysisProgress.value = { current: 0, total: 0 };
    } catch (error) {
        console.error('Error in batch analysis:', error);
        alert(error instanceof Error ? error.message : t('websiteAnalysis.analysis_error') || 'Analysis failed');
    } finally {
        analyzing.value = false;
        analysisProgress.value = { current: 0, total: 0 };
    }
}
// },
// }
// const editItem = (item) => {
 
// };
// const openfolder=(item)=>{
//     // console.log(item)
    
// }

</script>
<style scoped>
.table-scroll-container {
  width: 100%;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
}

.table-scroll-container::-webkit-scrollbar {
  height: 8px;
}

.table-scroll-container::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.table-scroll-container::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

.table-scroll-container::-webkit-scrollbar-thumb:hover {
  background: #555;
}

.custom-data-table {
  min-width: 100%;
  width: max-content;
}

.custom-data-table .v-data-table__wrapper tr {
  height: 50px; /* Set the desired row height */
}

.custom-data-table .v-data-table__wrapper td {
  height: 50px; /* Set the desired cell height */
}

.link-cell-container {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.link-cell {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  text-decoration: none;
  min-width: 0; /* Allows flex item to shrink below content size */
}

.link-cell:hover {
  text-decoration: underline;
}

.copy-btn {
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.copy-btn:hover {
  opacity: 1;
}

.ai-industry-cell {
  display: flex;
  align-items: center;
}

.ai-match-score-cell {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

/* Ensure the link column doesn't grow beyond max-width */
.custom-data-table :deep(.v-data-table__wrapper) td:nth-child(3) {
  max-width: 400px;
  overflow: hidden;
}
</style>