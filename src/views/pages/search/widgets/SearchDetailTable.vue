<template>
    <div class="search_bar mt-4 d-flex jsb mb-4">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field
rounded class="elevation-0" density="compact" variant="solo" :label="t('common.search') || 'Search'"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"
                    @keyup.enter="handleSearch" @click:append-inner="handleSearch"></v-text-field>
            </div>
            <!-- <v-btn class="btn mr-2" variant="flat" prepend-icon="mdi-filter-variant"><span> {{t('common.more')}}</span></v-btn> -->
            <v-btn class="btn mr-2" variant="flat" color="info" prepend-icon="mdi-robot" @click="handleAiAnalyze" :disabled="selectedCount === 0" :loading="analyzing">
                <span>{{ t('websiteAnalysis.analyze_button') || 'AI Analyze' }} {{ selectedCount > 0 ? `(${selectedCount})` : '' }}</span>
            </v-btn>
            <v-btn class="btn mr-2" variant="flat" color="purple" prepend-icon="mdi-card-account-mail" @click="handleContactExtraction" :disabled="selectedCount === 0" :loading="extracting">
                <span>Get Contact Info {{ selectedCount > 0 ? `(${selectedCount})` : '' }}</span>
            </v-btn>
            <v-btn class="btn mr-2" variant="flat" color="success" prepend-icon="mdi-email-search" @click="handleScrapeEmail" :disabled="selectedCount === 0">
                <span>{{ buttonText }}</span>
            </v-btn>
            <v-btn class="btn" variant="flat" color="primary" prepend-icon="mdi-download" @click="handleExport" :loading="exporting">
                <span>{{ t('common.export') }}</span>
            </v-btn>
        </div>     
    </div>
    <div class="table-scroll-container">
        <v-data-table-server
v-model:items-per-page="itemsPerPage" v-model="selectedItems" 
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
            <template v-slot:[`item.ai_analysis_status`]="{ item }">
                <div class="ai-status-cell">
                    <v-chip
                        v-if="item.ai_analysis_status"
                        size="small"
                        :color="getStatusColor(item.ai_analysis_status)"
                        variant="flat"
                    >
                        {{ getStatusText(item.ai_analysis_status) }}
                    </v-chip>
                    <span v-else class="text-grey">-</span>
                </div>
            </template>
            <template v-slot:[`item.extraction_status`]="{ item }">
                <div class="extraction-status-cell">
                    <v-chip
                        v-if="getContactExtractionStatus(item.id)"
                        size="small"
                        :color="getExtractionStatusColor(getContactExtractionStatus(item.id))"
                        variant="flat"
                    >
                        {{ getExtractionStatusText(getContactExtractionStatus(item.id)) }}
                    </v-chip>
                    <span v-else class="text-grey">-</span>
                </div>
            </template>
            <template v-slot:[`item.contact_email`]="{ item }">
                <div class="contact-email-cell">
                    <div v-if="getContactInfo(item.id)?.email" class="d-flex align-center">
                        <v-tooltip location="top" :text="getContactInfo(item.id).email">
                            <template v-slot:activator="{ props }">
                                <span v-bind="props" class="text-truncate" style="max-width: 180px;">
                                    {{ getContactInfo(item.id).email }}
                                </span>
                            </template>
                        </v-tooltip>
                        <v-btn
                            icon
                            size="x-small"
                            variant="text"
                            density="compact"
                            @click="copyToClipboard(getContactInfo(item.id).email)"
                            class="ml-1"
                        >
                            <v-icon size="small">mdi-content-copy</v-icon>
                        </v-btn>
                    </div>
                    <span v-else class="text-grey">-</span>
                </div>
            </template>
            <template v-slot:[`item.contact_phone`]="{ item }">
                <div class="contact-phone-cell">
                    <div v-if="getContactInfo(item.id)?.phone" class="d-flex align-center">
                        <span class="text-truncate" style="max-width: 130px;">
                            {{ getContactInfo(item.id).phone }}
                        </span>
                        <v-btn
                            icon
                            size="x-small"
                            variant="text"
                            density="compact"
                            @click="copyToClipboard(getContactInfo(item.id).phone)"
                            class="ml-1"
                        >
                            <v-icon size="small">mdi-content-copy</v-icon>
                        </v-btn>
                    </div>
                    <span v-else class="text-grey">-</span>
                </div>
            </template>
            <template v-slot:[`item.contact_address`]="{ item }">
                <div class="contact-address-cell">
                    <v-tooltip location="top" :text="getContactInfo(item.id)?.address || ''">
                        <template v-slot:activator="{ props }">
                            <span
                                v-if="getContactInfo(item.id)?.address"
                                v-bind="props"
                                class="text-truncate d-inline-block"
                                style="max-width: 180px;"
                            >
                                {{ truncateAddress(getContactInfo(item.id).address) }}
                            </span>
                            <span v-else class="text-grey">-</span>
                        </template>
                    </v-tooltip>
                </div>
            </template>
        </v-data-table-server>
    </div>
    
    <!-- Website Analysis Dialog -->
    <WebsiteAnalysisDialog
        :show-dialog="showAnalysisDialog"
        :loading="analyzing"
        :item-count="selectedResultsForAnalysis.length"
        :progress="analysisProgress"
        @dialogclose="closeAnalysisDialog"
        @analyze="handleAnalyzeConfirm"
    />
</template>

<script setup lang="ts">
import {useI18n} from "vue-i18n";
import { gettaskresult, exportSearchResults, analyzeWebsiteBatch, receiveAnalyzeWebsiteProgress, type AnalyzeWebsiteProgressData } from '@/views/api/search'
import { contactExtractionApi } from '@/views/api/contactExtraction'
import { ref,computed,onMounted,onUnmounted,watch } from 'vue'
import { SearchResult } from '@/views/api/types'
import {SearchResEntityDisplay} from "@/entityTypes/scrapeType"
import router from '@/views/router';
import { useRoute } from "vue-router";
import { SearchResultFetchparam } from "@/entityTypes/searchControlType"
import {CapitalizeFirstLetter} from "@/views/utils/function"
import WebsiteAnalysisDialog from '@/views/components/widgets/websiteAnalysisDialog.vue'
import { getSystemSettinglist, updateSystemSetting } from '@/views/api/systemsetting'
import { ai_website_analysis_business_info } from '@/config/settinggroupInit'

const $route = useRoute();
const {t} = useI18n({inheritLocale: true});
const taskid = parseInt($route.params.id.toString());

const initialize = async () => {
console.log($route.params.id)
//   if ($route.params.id) {
//     taskid.value = parseInt($route.params.id.toString());
//   }
}
/**
 * Start auto-refresh timer
 */
function startAutoRefresh(): void {
    if (autoRefreshInterval.value) {
        clearInterval(autoRefreshInterval.value);
    }
    
    if (autoRefreshEnabled.value) {
        autoRefreshInterval.value = setInterval(() => {
            if (taskid && !loading.value && !analyzing.value) {
                loadItems({ 
                    page: currentPage.value, 
                    itemsPerPage: itemsPerPage.value, 
                    sortBy: '' 
                }, true); // Pass isAutoRefresh flag
            }
        }, autoRefreshIntervalMs.value);
    }
}

/**
 * Stop auto-refresh timer
 */
function stopAutoRefresh(): void {
    if (autoRefreshInterval.value) {
        clearInterval(autoRefreshInterval.value);
        autoRefreshInterval.value = null;
    }
}

/**
 * Handle page visibility changes
 */
function handleVisibilityChange(): void {
    isPageVisible.value = !document.hidden;
    // Restart auto-refresh when page becomes visible
    if (isPageVisible.value && autoRefreshEnabled.value) {
        startAutoRefresh();
    }
}

// Progress listener cleanup function
let cleanupProgressListener: (() => void) | null = null;

onMounted(() => {
  initialize();
  // Start auto-refresh
  startAutoRefresh();
  // Add page visibility listener
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Set up contact extraction progress listener
  cleanupProgressListener = contactExtractionApi.onContactExtractionProgress((progress) => {
      console.log('Contact extraction progress:', progress);

      // Update contact info map with progress data
      if (progress.status === 'completed' && progress.data) {
          const info = {
              resultId: progress.resultId,
              email: progress.data.emails?.[0] || null,
              phone: progress.data.phones?.[0] || null,
              address: progress.data.address || null,
              socialLinks: progress.data.socialLinks || null,
              extractionStatus: progress.status,
              extractionError: null
          };
          contactInfoMap.value.set(progress.resultId, info);
      } else if (progress.status === 'failed') {
          const existing = contactInfoMap.value.get(progress.resultId) || {};
          contactInfoMap.value.set(progress.resultId, {
              ...existing,
              resultId: progress.resultId,
              extractionStatus: progress.status,
              extractionError: progress.error
          });
      } else {
          const existing = contactInfoMap.value.get(progress.resultId) || {};
          contactInfoMap.value.set(progress.resultId, {
              ...existing,
              resultId: progress.resultId,
              extractionStatus: progress.status
          });
      }

      // Reload data to show updated status
      if (taskid && !loading.value) {
          loadItems({
              page: currentPage.value,
              itemsPerPage: itemsPerPage.value,
              sortBy: ''
          }, true);
      }
  });
});

onUnmounted(() => {
    // Clean up auto-refresh timer
    stopAutoRefresh();
    // Remove page visibility listener
    document.removeEventListener('visibilitychange', handleVisibilityChange);

    // Clean up contact extraction progress listener
    if (cleanupProgressListener) {
        cleanupProgressListener();
        cleanupProgressListener = null;
    }
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
        // console.log(fetchparam)
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
    {
        title: computed(_ => CapitalizeFirstLetter(t("websiteAnalysis.status") || 'Analysis Status')),
        align: 'start',
        sortable: false,
        key: 'ai_analysis_status',
        width: '150px',
        minWidth: '120px',
    },
    {
        title: 'Contact Extraction',
        align: 'start',
        sortable: false,
        key: 'extraction_status',
        width: '150px',
        minWidth: '120px',
    },
    {
        title: 'Email',
        align: 'start',
        sortable: false,
        key: 'contact_email',
        width: '200px',
        minWidth: '150px',
    },
    {
        title: 'Phone',
        align: 'start',
        sortable: false,
        key: 'contact_phone',
        width: '150px',
        minWidth: '120px',
    },
    {
        title: 'Address',
        align: 'start',
        sortable: false,
        key: 'contact_address',
        width: '200px',
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
const extracting = ref(false);
const showAnalysisDialog = ref(false);
const selectedResultsForAnalysis = ref<SearchResEntityDisplay[]>([]);
const currentPage = ref(1);
const analysisProgress = ref({ current: 0, total: 0 });

// Contact extraction state
const contactInfoMap = ref<Map<number, any>>(new Map());

// Auto-refresh functionality
const autoRefreshEnabled = ref(true); // Enable by default
const autoRefreshInterval = ref<NodeJS.Timeout | null>(null);
const autoRefreshIntervalMs = ref(10000); // 10 seconds default
const isPageVisible = ref(true);
const lastRefreshTime = ref<Date | null>(null);

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
 * Get color for analysis status chip
 * @param status - The analysis status
 * @returns Color name for the chip
 */
function getStatusColor(status: string): string {
    switch (status) {
        case 'completed':
            return 'success'; // Green for completed
        case 'analyzing':
            return 'info'; // Blue for in progress
        case 'failed':
            return 'error'; // Red for failed
        case 'pending':
            return 'warning'; // Orange for pending
        default:
            return 'grey'; // Grey for unknown
    }
}

/**
 * Get display text for analysis status
 * @param status - The analysis status
 * @returns Display text
 */
function getStatusText(status: string): string {
    switch (status) {
        case 'completed':
            return t('websiteAnalysis.status_completed') || 'Completed';
        case 'analyzing':
            return t('websiteAnalysis.status_analyzing') || 'Analyzing';
        case 'failed':
            return t('websiteAnalysis.status_failed') || 'Failed';
        case 'pending':
            return t('websiteAnalysis.status_pending') || 'Pending';
        default:
            return status;
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

function loadItems({ page, itemsPerPage, sortBy }, isAutoRefresh = false) {
    // Skip auto-refresh if page is not visible or currently analyzing
    if (isAutoRefresh && (!isPageVisible.value || analyzing.value)) {
        return;
    }

    currentPage.value = page;
    loading.value = true
    //console.log(taskid)
    if(!taskid){
        loading.value = false;
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
            // Clear selected items when data changes (new page or search) - but not during auto-refresh
            if (!isAutoRefresh) {
                selectedItems.value = []
            }
            lastRefreshTime.value = new Date();
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

    exporting.value = true;
    try {
        // Export as CSV including contact info
        const filePath = await exportSearchResults(taskid, 'csv');

        // If we have contact info, export it separately
        if (contactInfoMap.value.size > 0) {
            await exportContactInfoToCSV();
        }

        if (filePath) {
            console.log(`Export successful: ${filePath}`);
        }
    } catch (error) {
        console.error('Export failed:', error);
        alert(error instanceof Error ? error.message : 'Export failed');
    } finally {
        exporting.value = false;
    }
}

/**
 * Export contact info to CSV
 */
async function exportContactInfoToCSV() {
    try {
        // Get all contact info
        const contactInfoData: any[] = [];

        // Map server items with their contact info
        serverItems.value.forEach(item => {
            const contactInfo = contactInfoMap.value.get(item.id);
            if (contactInfo && contactInfo.extractionStatus === 'completed') {
                contactInfoData.push({
                    'ID': item.id,
                    'Title': item.title || '',
                    'URL': item.link || '',
                    'Email': contactInfo.email || '',
                    'Phone': contactInfo.phone || '',
                    'Address': contactInfo.address || '',
                    'Social Links': contactInfo.socialLinks ? contactInfo.socialLinks.join('; ') : '',
                    'Extraction Date': contactInfo.extractionDate || '',
                    'Status': contactInfo.extractionStatus || ''
                });
            }
        });

        if (contactInfoData.length === 0) {
            console.log('No completed contact info to export');
            return;
        }

        // Convert to CSV
        const headers = Object.keys(contactInfoData[0]);
        const csvContent = [
            headers.join(','),
            ...contactInfoData.map(row =>
                headers.map(header => {
                    const value = row[header];
                    // Escape values containing commas or quotes
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value || '';
                }).join(',')
            )
        ].join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `contact_info_${taskid}_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log(`Exported ${contactInfoData.length} contact info records`);
    } catch (error) {
        console.error('Failed to export contact info:', error);
        throw error;
    }
}

/**
 * Handle contact extraction button click
 */
async function handleContactExtraction() {
    if (selectedItems.value.length === 0) {
        alert('Please select at least one item to extract contact info');
        return;
    }

    extracting.value = true;

    try {
        // Get actual selected items
        const selectedItemValues = new Set(selectedItems.value);
        const actualSelectedItems = serverItems.value.filter(item => {
            const itemValue = getItemValue(item);
            return selectedItemValues.has(itemValue);
        });

        const resultIds = actualSelectedItems.map(item => item.id);

        console.log('Starting contact extraction for result IDs:', resultIds);

        // Start extraction
        const response = await contactExtractionApi.startContactExtraction(resultIds);

        if (response.success) {
            console.log('Contact extraction started:', response.batchId);

            // Load contact info for selected items
            await loadContactInfo(resultIds);
        } else {
            console.error('Failed to start contact extraction:', response.message);
            alert(`Failed to start extraction: ${response.message}`);
        }
    } catch (error) {
        console.error('Error starting contact extraction:', error);
        alert(`Error: ${error}`);
    } finally {
        extracting.value = false;
    }
}

/**
 * Load contact info for specific result IDs
 */
async function loadContactInfo(resultIds: number[]) {
    try {
        const response = await contactExtractionApi.getContactInfo(resultIds);

        if (response.success && response.data) {
            // Update contact info map
            response.data.forEach(info => {
                contactInfoMap.value.set(info.resultId, info);
            });

            console.log('Loaded contact info for', response.data.length, 'items');
        }
    } catch (error) {
        console.error('Error loading contact info:', error);
    }
}

/**
 * Get contact extraction status for an item
 */
function getContactExtractionStatus(resultId: number): string | undefined {
    return contactInfoMap.value.get(resultId)?.extractionStatus;
}

/**
 * Get contact info for an item
 */
function getContactInfo(resultId: number): any {
    return contactInfoMap.value.get(resultId);
}

/**
 * Get color for extraction status
 */
function getExtractionStatusColor(status: string): string {
    switch (status) {
        case 'completed':
            return 'success';
        case 'analyzing':
            return 'info';
        case 'failed':
            return 'error';
        case 'pending':
            return 'warning';
        default:
            return 'grey';
    }
}

/**
 * Get display text for extraction status
 */
function getExtractionStatusText(status: string): string {
    switch (status) {
        case 'completed':
            return 'Completed';
        case 'analyzing':
            return 'Analyzing';
        case 'failed':
            return 'Failed';
        case 'pending':
            return 'Pending';
        default:
            return status;
    }
}

/**
 * Truncate address for display
 */
function truncateAddress(address: string, maxLength = 30): string {
    if (!address) return '';
    if (address.length <= maxLength) return address;
    return address.substring(0, maxLength) + '...';
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        console.log('Copied to clipboard:', text);
    } catch (error) {
        console.error('Failed to copy:', error);
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
function truncateLink(link: string, maxLength = 50): string {
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
 * Save business info to system settings
 */
async function saveBusinessInfoToSettings(businessInfo: string): Promise<void> {
    try {
        const settingsGroups = await getSystemSettinglist();
        
        // Find the setting in user_preferences group
        for (const group of settingsGroups) {
            if (group.name === 'user_preferences') {
                const businessInfoSetting = group.items.find(s => s.key === ai_website_analysis_business_info);
                
                if (businessInfoSetting) {
                    const dataToSave = {
                        business: businessInfo.trim()
                    };
                    
                    await updateSystemSetting(businessInfoSetting.id, JSON.stringify(dataToSave));
                }
                break;
            }
        }
    } catch (error) {
        console.error('Error saving business info to settings:', error);
        throw error;
    }
}

/**
 * Handle analyze confirmation from dialog
 */
async function handleAnalyzeConfirm(data: { businessInfo: string; saveForFuture: boolean }): Promise<void> {
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
        const progressHandler = (progress: AnalyzeWebsiteProgressData) => {
            if (progress.batchId === currentBatchId) {
                analysisProgress.value = {
                    current: progress.completed || 0,
                    total: progress.total || validItems.length
                };
                
                // Refresh table when progress updates (to show completed analyses)
                if (progress.completed > 0 && taskid && !loading.value) {
                    loadItems({ 
                        page: currentPage.value, 
                        itemsPerPage: itemsPerPage.value, 
                        sortBy: '' 
                    }, true);
                }
                
                // If all items are completed, refresh and clear analyzing flag
                if (progress.completed >= progress.total) {
                    analyzing.value = false;
                    selectedResultsForAnalysis.value = [];
                    analysisProgress.value = { current: 0, total: 0 };
                    
                    // Refresh table to show final results
                    setTimeout(() => {
                        if (taskid && !loading.value) {
                            loadItems({ 
                                page: currentPage.value, 
                                itemsPerPage: itemsPerPage.value, 
                                sortBy: '' 
                            }, true);
                        }
                    }, 1000);
                }
            }
        };

        receiveAnalyzeWebsiteProgress(progressHandler);

        // Prepare batch request
        // TypeScript: validItems are already filtered to have id and link
        const batchRequest = {
            items: validItems.map(item => ({
                resultId: item.id as number, // Safe: already filtered for id existence
                url: item.link as string // Safe: already filtered for link existence
            })),
            clientBusiness: data.businessInfo,
            temperature: 0.7 // Default temperature value
        };

        // Send batch request
        const response = await analyzeWebsiteBatch(batchRequest);
        console.log(response)
        if (!response) {
            throw new Error('Failed to start batch analysis');
        }

        currentBatchId = response.batchId;
        const total = response.total;

        // Save business info to system settings if requested
        if (data.saveForFuture) {
            try {
                await saveBusinessInfoToSettings(data.businessInfo);
            } catch (error) {
                console.error('Error saving business info to settings:', error);
                // Don't block the analysis if saving fails
            }
        }

        // Show success message
        alert(t('websiteAnalysis.analysis_success') || `Analysis task started successfully for ${total} item(s). Results will be updated automatically.`);
        
        // Close dialog
        showAnalysisDialog.value = false;
        
        // Keep analyzing flag true until we detect completion via progress updates
        // The progress handler will update the table as items complete and clear the flag when done
        // Set a timeout to clear analyzing flag as a fallback (in case progress updates fail)
        const fallbackTimeout = setTimeout(() => {
            if (analyzing.value) {
                analyzing.value = false;
                selectedResultsForAnalysis.value = [];
                analysisProgress.value = { current: 0, total: 0 };
            }
        }, Math.max(120000, total * 30000)); // Fallback timeout: 2 minutes minimum, or 30s per item
        
        // Clear fallback timeout if analysis completes normally (handled in progress handler)
        // Note: This is a simple implementation - in production you might want to store the timeout ID
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

.ai-status-cell {
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