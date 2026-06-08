<template>
  <v-col cols="12">
    <v-data-table-server
      v-model="selected"
      :items-per-page="itemsPerPage"
      :headers="headers"
      :items-length="totalItems"
      :items="serverItems"
      :loading="loading"
      item-value="id"
      @update:options="loadItems"
      class="custom-data-table"
      return-object
      show-select
      select-strategy="single"
    />
  </v-col>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref, computed, watch, onMounted, reactive } from "vue";
import {
  getGoogleMapsHistory,
  type GoogleMapsHistoryRecord,
} from "@/views/api/googleMaps";
import { CapitalizeFirstLetter } from "@/views/utils/function";

const props = defineProps({
  selectedValue: {
    type: Number,
    default: 0,
  },
});

const { t } = useI18n({ inheritLocale: true });

const options = reactive({
  page: 1,
  itemsPerPage: 10,
});

const itemsPerPage = ref(10);
const serverItems = ref<Array<GoogleMapsHistoryRecord>>([]);
const loading = ref(false);
const totalItems = ref(0);
const selected = ref<GoogleMapsHistoryRecord>();

const headers = ref<Array<any>>([]);
headers.value = [
  {
    title: computed((_) => CapitalizeFirstLetter(t("common.id") || "ID")),
    align: "center",
    sortable: false,
    key: "id",
  },
  {
    title: computed((_) =>
      CapitalizeFirstLetter(t("googleMaps.query_label") || "Query")
    ),
    align: "start",
    sortable: false,
    key: "query",
  },
  {
    title: computed((_) =>
      CapitalizeFirstLetter(t("googleMaps.location_label") || "Location")
    ),
    align: "start",
    sortable: false,
    key: "location",
  },
  {
    title: computed((_) =>
      CapitalizeFirstLetter(t("common.status") || "Status")
    ),
    align: "start",
    sortable: false,
    key: "status",
  },
  {
    title: computed((_) =>
      CapitalizeFirstLetter(t("googleMaps.results_count") || "Results")
    ),
    align: "center",
    sortable: false,
    key: "totalResults",
  },
  {
    title: computed((_) =>
      CapitalizeFirstLetter(t("common.created_at") || "Created")
    ),
    align: "start",
    sortable: false,
    key: "createdAt",
  },
];

function loadItems({ page = 1, itemsPerPage:ipp = 10 }: { page: number; itemsPerPage: number }) {
  options.page = page;
  loading.value = true;
  const offset = (page - 1) * ipp;
  getGoogleMapsHistory(ipp, offset)
    .then(({ records, total }) => {
      serverItems.value = records;
      totalItems.value = total;
      loading.value = false;

      if (props.selectedValue && props.selectedValue > 0) {
        const selectedItem = records.find(
          (item) => item.id === props.selectedValue
        );
        if (selectedItem) {
          selected.value = selectedItem;
        }
      }
    })
    .catch((error) => {
      console.error(error);
      loading.value = false;
    });
}

const emit = defineEmits(["change"]);

onMounted(() => {
  if (props.selectedValue && props.selectedValue > 0) {
    loadItems({ page: 1, itemsPerPage: 10 });
  }
});

watch(selected, (newValue: GoogleMapsHistoryRecord | undefined) => {
  emit("change", newValue ? [newValue] : undefined);
});
</script>

<style scoped>
.custom-data-table .v-data-table__wrapper tr {
  height: 50px;
}
.custom-data-table .v-data-table__wrapper td {
  height: 50px;
}
</style>
