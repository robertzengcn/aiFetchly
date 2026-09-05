<template>
  <!--
    Normalized table geometry and slots (design §13.2, §27.2).
    Wraps Vuetify's v-data-table with density/header/selection defaults
    and passes through slots so feature pages own their columns.
  -->
  <v-data-table
    :items="items"
    :headers="normalizedHeaders"
    :density="density"
    :hover="true"
    :items-per-page="itemsPerPage"
    :show-select="selectable"
    v-model="selectedModel"
    class="app-data-table"
    data-testid="app-data-table"
  >
    <template v-for="(_, name) in $slots" #[name]="slotData">
      <slot :name="name" v-bind="slotData ?? {}" />
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { computed } from "vue";

type Density = "default" | "comfortable" | "compact";

interface NormalizedHeader {
  title: string;
  key: string;
  sortable?: boolean;
  align?: "start" | "center" | "end";
  width?: string;
}

const props = withDefaults(
  defineProps<{
    items: readonly unknown[];
    headers: readonly NormalizedHeader[];
    density?: Density;
    itemsPerPage?: number;
    selectable?: boolean;
    modelValue?: unknown[];
  }>(),
  {
    density: "compact" as Density,
    itemsPerPage: 20,
    selectable: false,
  }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: unknown[]): void;
}>();

const normalizedHeaders = computed(() =>
  props.headers.map((h) => ({
    title: h.title,
    key: h.key,
    sortable: h.sortable ?? true,
    align: h.align ?? "start",
    width: h.width,
  }))
);

const selectedModel = computed({
  get: () => props.modelValue ?? [],
  set: (val) => emit("update:modelValue", val as unknown[]),
});
</script>

<style scoped>
.app-data-table {
  border-radius: var(--app-radius-panel);
}

.app-data-table :deep(.v-data-table__th) {
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--app-text-muted);
}
</style>
