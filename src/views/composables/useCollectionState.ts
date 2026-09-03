import { computed, ref, shallowRef, type Ref } from "vue";
import type {
  CollectionQuery,
} from "@/views/types/uiConvergenceTypes";

/**
 * Collection UI query state with request generation (design §13.3/§13.4):
 * search/filter/sort/paging transitions own the reset rules; the loader is
 * feature-supplied — this composable never calls IPC.
 */
export function useCollectionState<
  TFilter extends Record<string, unknown>,
>(options?: {
  initialFilters?: TFilter;
  pageSize?: number;
  debounceMs?: number;
}): {
  query: Ref<CollectionQuery<TFilter>>;
  searchTerm: Ref<string>;
  selection: Ref<ReadonlySet<string | number>>;
  requestGeneration: Ref<number>;
  hasSelection: Ref<boolean>;
  setPage(page: number): void;
  setFilter<K extends keyof TFilter>(key: K, value: TFilter[K]): void;
  setSort(key: string, order: "asc" | "desc"): void;
  setSearch(value: string): void;
  resetFilters(): void;
  toggleSelection(key: string | number): void;
  clearSelection(): void;
  dropSelection(keys: readonly (string | number)[]): void;
  beginRequest(): number;
} {
  const pageSize = options?.pageSize ?? 20;
  const debounceMs = options?.debounceMs ?? 250;

  const query = shallowRef<CollectionQuery<TFilter>>({
    search: "",
    filters: { ...(options?.initialFilters ?? ({} as TFilter)) },
    page: 0,
    pageSize,
    sort: [],
  });
  const searchTerm = ref("");
  const selection = shallowRef<ReadonlySet<string | number>>(new Set());
  const requestGeneration = ref(0);

  let searchTimer: number | null = null;

  /** Test/SSR-safe timer access (no window in the node environment). */
  const timerApi: {
    setTimeout(fn: () => void, ms: number): number;
    clearTimeout(id: number): void;
  } =
    typeof window !== "undefined"
      ? window
      : {
          setTimeout: (fn: () => void, ms: number) =>
            Number(setTimeout(fn, ms)),
          clearTimeout: (id: number) => clearTimeout(id),
        };

  function bump(): void {
    requestGeneration.value += 1;
  }

  function setPage(page: number): void {
    query.value = { ...query.value, page: Math.max(0, page) };
    bump();
  }

  /** Filter changes reset the page index (design §13.4). */
  function setFilter<K extends keyof TFilter>(key: K, value: TFilter[K]): void {
    query.value = {
      ...query.value,
      filters: { ...query.value.filters, [key]: value },
      page: 0,
    };
    bump();
  }

  function setSort(key: string, order: "asc" | "desc"): void {
    query.value = { ...query.value, sort: [{ key, order }] };
    bump();
  }

  /** Debounced search; clear resets the page immediately. */
  function setSearch(value: string): void {
    searchTerm.value = value;
    if (searchTimer !== null) timerApi.clearTimeout(searchTimer);
    if (value === "") {
      query.value = { ...query.value, search: "", page: 0 };
      bump();
      return;
    }
    searchTimer = timerApi.setTimeout(() => {
      query.value = { ...query.value, search: searchTerm.value, page: 0 };
      bump();
    }, debounceMs);
  }

  function resetFilters(): void {
    query.value = {
      ...query.value,
      filters: { ...(options?.initialFilters ?? ({} as TFilter)) },
      search: "",
      page: 0,
    };
    searchTerm.value = "";
    bump();
  }

  /** Selection keys are stable domain identifiers (design §13.5). */
  function toggleSelection(key: string | number): void {
    const next = new Set(selection.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.value = next;
  }

  function clearSelection(): void {
    selection.value = new Set();
  }

  /** Filters removing selected records clear that selection (design §13.5). */
  function dropSelection(keys: readonly (string | number)[]): void {
    const removed = new Set(keys);
    const next = new Set(
      [...selection.value].filter((key) => !removed.has(key))
    );
    selection.value = next;
  }

  function beginRequest(): number {
    requestGeneration.value += 1;
    return requestGeneration.value;
  }

  const hasSelection = computed(() => selection.value.size > 0);

  return {
    query,
    searchTerm,
    selection,
    requestGeneration,
    hasSelection,
    setPage,
    setFilter,
    setSort,
    setSearch,
    resetFilters,
    toggleSelection,
    clearSelection,
    dropSelection,
    beginRequest,
  };
}
