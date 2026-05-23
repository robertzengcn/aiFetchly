---
wave: 1
depends_on: []
files_modified:
  - src/config/channellist.ts
  - src/main-process/communication/googleMaps-ipc.ts
  - src/views/api/googleMaps.ts
  - src/views/pages/google-maps-scraper/index.vue
  - src/views/router/index.ts
  - src/views/lang/en.ts
  - src/views/lang/zh.ts
  - src/views/lang/es.ts
  - src/views/lang/fr.ts
  - src/views/lang/de.ts
  - src/views/lang/ja.ts
autonomous: true
requirements:
  - FR-6
  - FR-7
  - FR-8
  - FR-11
---

# Plan 1: IPC Handlers, API Wrapper, Vue Page, Router, and i18n

## Goal

Complete the user-facing integration layer: IPC handlers for UI execution, typed frontend API wrapper, Vue UI page with search form and results, route registration, and translations for all 6 languages.

## Tasks

### Task 1: Add IPC Channels and Handler

<read_first>
- src/config/channellist.ts (channel constant pattern)
- src/main-process/communication/contactExtraction-ipc.ts (IPC handler pattern)
- src/modules/GoogleMapsModule.ts (module to delegate to)
</read_first>

<action>
1. Add channel constants to `src/config/channellist.ts` (after existing entries):

```typescript
// Google Maps Scraper
export const GOOGLE_MAPS_SEARCH_START = "google_maps:search_start";
export const GOOGLE_MAPS_SEARCH_CANCEL = "google_maps:search_cancel";
export const GOOGLE_MAPS_SEARCH_PROGRESS = "google_maps:search_progress";
export const GOOGLE_MAPS_SEARCH_RESULT = "google_maps:search_result";
```

2. Create `src/main-process/communication/googleMaps-ipc.ts`:

```typescript
import { ipcMain, BrowserWindow } from "electron";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import {
  GOOGLE_MAPS_SEARCH_START,
  GOOGLE_MAPS_SEARCH_CANCEL,
  GOOGLE_MAPS_SEARCH_PROGRESS,
  GOOGLE_MAPS_SEARCH_RESULT,
} from "@/config/channellist";
import type { GoogleMapsSearchInput, GoogleMapsProgressEvent } from "@/entityTypes/googleMapsTypes";

const activeModules = new Map<string, GoogleMapsModule>();

export function registerGoogleMapsHandlers(): void {
  ipcMain.handle(GOOGLE_MAPS_SEARCH_START, async (event, data: Record<string, unknown>) => {
    const query = typeof data.query === "string" ? data.query : "";
    const location = typeof data.location === "string" ? data.location : "";

    if (!query.trim() || !location.trim()) {
      return { status: false, msg: "query and location are required", data: null };
    }

    const requestId = `gm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const module = new GoogleMapsModule();
    activeModules.set(requestId, module);

    const input: GoogleMapsSearchInput = {
      query: query.trim(),
      location: location.trim(),
      max_results: typeof data.max_results === "number" ? data.max_results : 20,
      include_website: typeof data.include_website === "boolean" ? data.include_website : true,
      include_reviews: typeof data.include_reviews === "boolean" ? data.include_reviews : false,
      show_browser: typeof data.show_browser === "boolean" ? data.show_browser : false,
    };

    // Execute search asynchronously, send progress/result via push events
    module.executeSearch(input)
      .then((result) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send(GOOGLE_MAPS_SEARCH_RESULT, { requestId, result });
        }
        activeModules.delete(requestId);
      })
      .catch((error) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send(GOOGLE_MAPS_SEARCH_RESULT, {
            requestId,
            result: {
              success: false,
              query: input.query,
              location: input.location,
              totalResults: 0,
              summary: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
              results: [],
            },
          });
        }
        activeModules.delete(requestId);
      });

    return { status: true, msg: "Search started", data: { requestId } };
  });

  ipcMain.handle(GOOGLE_MAPS_SEARCH_CANCEL, async (event, data: Record<string, unknown>) => {
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    if (!requestId) {
      return { status: false, msg: "requestId is required", data: null };
    }

    const module = activeModules.get(requestId);
    if (module) {
      await module.cancelSearch(requestId);
      activeModules.delete(requestId);
    }

    return { status: true, msg: "Search cancelled", data: null };
  });
}
```

3. Register the handler in `src/background.ts` (find where other IPC handlers are registered, add):
```typescript
import { registerGoogleMapsHandlers } from "@/main-process/communication/googleMaps-ipc";
// In the app.whenReady() section:
registerGoogleMapsHandlers();
```
</action>

<acceptance_criteria>
- `src/config/channellist.ts` exports `GOOGLE_MAPS_SEARCH_START`, `GOOGLE_MAPS_SEARCH_CANCEL`, `GOOGLE_MAPS_SEARCH_PROGRESS`, `GOOGLE_MAPS_SEARCH_RESULT`
- `src/main-process/communication/googleMaps-ipc.ts` exists with `registerGoogleMapsHandlers()` function
- Handler for `GOOGLE_MAPS_SEARCH_START` validates input, creates GoogleMapsModule, starts async search
- Handler for `GOOGLE_MAPS_SEARCH_CANCEL` calls `module.cancelSearch()`
- Results pushed to renderer via `webContents.send(GOOGLE_MAPS_SEARCH_RESULT, ...)`
- `background.ts` calls `registerGoogleMapsHandlers()`
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 2: Create Frontend API Wrapper

<read_first>
- src/views/api/yellowpages.ts (API wrapper pattern)
- src/views/utils/apirequest.ts (windowInvoke utility)
- src/config/channellist.ts (channel constants — just added)
</read_first>

<action>
Create `src/views/api/googleMaps.ts`:

```typescript
import { windowInvoke } from "@/views/utils/apirequest";
import {
  GOOGLE_MAPS_SEARCH_START,
  GOOGLE_MAPS_SEARCH_CANCEL,
  GOOGLE_MAPS_SEARCH_PROGRESS,
  GOOGLE_MAPS_SEARCH_RESULT,
} from "@/config/channellist";
import type { GoogleMapsSearchResult, GoogleMapsProgressEvent } from "@/entityTypes/googleMapsTypes";

export interface GoogleMapsSearchStartResponse {
  requestId: string;
}

export interface GoogleMapsResultEvent {
  requestId: string;
  result: GoogleMapsSearchResult;
}

/** Start a Google Maps search. Returns requestId for tracking. */
export async function startGoogleMapsSearch(params: {
  query: string;
  location: string;
  max_results?: number;
  include_website?: boolean;
  include_reviews?: boolean;
  show_browser?: boolean;
}): Promise<GoogleMapsSearchStartResponse> {
  const resp = await windowInvoke(GOOGLE_MAPS_SEARCH_START, params);
  if (!resp || !resp.status) {
    throw new Error(resp?.msg ?? "Failed to start search");
  }
  return resp.data as GoogleMapsSearchStartResponse;
}

/** Cancel an active Google Maps search. */
export async function cancelGoogleMapsSearch(requestId: string): Promise<void> {
  await windowInvoke(GOOGLE_MAPS_SEARCH_CANCEL, { requestId });
}

/** Subscribe to result events. Returns unsubscribe function. */
export function onGoogleMapsResult(
  callback: (event: GoogleMapsResultEvent) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: GoogleMapsResultEvent) => {
    callback(data);
  };
  window.electronAPI.on(GOOGLE_MAPS_SEARCH_RESULT, handler);
  return () => {
    window.electronAPI.off(GOOGLE_MAPS_SEARCH_RESULT, handler);
  };
}
```
</action>

<acceptance_criteria>
- `src/views/api/googleMaps.ts` exists
- Exports `startGoogleMapsSearch`, `cancelGoogleMapsSearch`, `onGoogleMapsResult`
- Uses `windowInvoke` from apirequest
- Uses channel constants from channellist
- `onGoogleMapsResult` returns an unsubscribe function
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 3: Add Route and Register Page

<read_first>
- src/views/router/index.ts (route registration pattern — see Yellow Pages entry around line 517)
</read_first>

<action>
1. Add a new route entry to `constantRoutes` array in `src/views/router/index.ts`. Insert it after the Yellow Pages route block:

```typescript
{
  path: "/google-maps-scraper",
  name: "Google_Maps_Scraper",
  meta: {
    visible: true,
    title: "route.google_maps_scraper",
    icon: "mdi-map-marker-radius",
  },
  component: Layout,
  children: [
    {
      path: "",
      component: () => import("@/views/pages/google-maps-scraper/index.vue"),
      name: "GoogleMapsScraper",
      meta: {
        visible: true,
        title: "route.google_maps_scraper",
        icon: "mdi-map-marker-radius",
      },
    },
  ],
},
```

Note: This creates a single-page route (not list/detail/create like Yellow Pages). The `visible: true` makes it appear in the sidebar.
</action>

<acceptance_criteria>
- `src/views/router/index.ts` contains path `/google-maps-scraper`
- Route has `visible: true` in meta
- Route lazy imports `@/views/pages/google-maps-scraper/index.vue`
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 4: Create Vue UI Page

<read_first>
- src/views/pages/yellowpages/list.vue (page layout pattern reference)
- src/views/api/googleMaps.ts (just created — API wrapper)
- src/entityTypes/googleMapsTypes.ts (types)
</read_first>

<action>
Create `src/views/pages/google-maps-scraper/index.vue` — a Vue 3 + Vuetify page with Composition API.

The page should have:

1. **Search Form** (top section):
   - `v-text-field` for business keyword (query) — required
   - `v-text-field` for location — required
   - `v-slider` for max_results (1-50, default 20)
   - `v-switch` for include_website (default on)
   - `v-switch` for include_reviews (default off)
   - `v-switch` for show_browser (default off, for debugging)
   - `v-btn` "Start Search" (disabled when search is running or fields empty)
   - `v-btn` "Cancel" (visible only when search is running)

2. **Progress Section** (shown during search):
   - `v-progress-linear` showing current/total
   - Status text (localized)
   - `v-alert` for errors/timeouts

3. **Results Section** (shown after completion):
   - Summary text ("Found N businesses for 'query' in 'location'")
   - `v-data-table` with columns: Name, Category, Rating, Reviews, Address, Phone, Website
   - Each row clickable to expand for full details (hours, maps_url)
   - Export buttons: "Export CSV" and "Export JSON"

4. **State management** (Composition API refs):
   - `searchState`: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'
   - `requestId`: string | null
   - `progress`: { current, total, message }
   - `results`: GoogleMapsBusinessResult[]
   - `error`: string | null

5. **Key behaviors**:
   - On "Start Search": call `startGoogleMapsSearch()`, subscribe to result events
   - On result event: update results, set state to 'completed'
   - On "Cancel": call `cancelGoogleMapsSearch()`, set state to 'cancelled'
   - On component unmount: unsubscribe from events, cancel any running search
   - Export CSV using `papaparse.unparse()`
   - Export JSON using `JSON.stringify()`

6. **Use i18n** for all user-facing text: `t('googleMaps.key')`

Use `<script setup lang="ts">` and Vuetify components throughout. Keep the file under 500 lines.
</action>

<acceptance_criteria>
- `src/views/pages/google-maps-scraper/index.vue` exists
- Uses `<script setup lang="ts">`
- Has search form with query, location, max_results, include_website, include_reviews, show_browser fields
- Has start and cancel buttons
- Shows progress during search
- Displays results in a data table after completion
- Has CSV and JSON export buttons
- Uses `useI18n()` for all user-facing text
- Cleans up event subscriptions on unmount
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 5: Add i18n Translations for All 6 Languages

<read_first>
- src/views/lang/en.ts (structure and namespace pattern)
- src/views/lang/zh.ts, es.ts, fr.ts, de.ts, ja.ts (translation pattern)
</read_first>

<action>
Add a `googleMaps` namespace to ALL 6 language files with these keys:

**English (en.ts)** — add this object inside the default export:
```typescript
googleMaps: {
  title: "Google Maps Scraper",
  description: "Search Google Maps for local businesses by keyword and location",
  query_label: "Business Keyword",
  query_placeholder: "e.g. dentist, Italian restaurant, plumber",
  query_hint: "Enter a business type or name to search for",
  location_label: "Location",
  location_placeholder: "e.g. New York, London, 90210",
  location_hint: "Enter a city, address, or zip code",
  max_results_label: "Maximum Results",
  include_website: "Include Website",
  include_reviews: "Include Reviews",
  show_browser: "Show Browser (Debug)",
  start_search: "Start Search",
  cancel_search: "Cancel",
  searching: "Searching...",
  status_idle: "Ready to search",
  status_validating: "Validating input...",
  status_launching: "Launching browser...",
  status_loading: "Loading Google Maps...",
  status_extracting: "Extracting businesses ({current}/{total})...",
  status_completed: "Search completed",
  status_cancelled: "Search cancelled",
  status_failed: "Search failed",
  status_timed_out: "Search timed out",
  no_results: "No businesses found",
  found_results: "Found {count} businesses for '{query}' in '{location}'",
  col_name: "Name",
  col_category: "Category",
  col_rating: "Rating",
  col_reviews: "Reviews",
  col_address: "Address",
  col_phone: "Phone",
  col_website: "Website",
  col_hours: "Hours",
  export_csv: "Export CSV",
  export_json: "Export JSON",
  export_success: "Export successful",
  error_required: "Query and location are required",
  error_search_failed: "Search failed: {error}",
  view_on_maps: "View on Google Maps",
  reviews_count: "{count} reviews",
},
```

**Chinese (zh.ts)**:
```typescript
googleMaps: {
  title: "Google 地图抓取器",
  description: "按关键字和位置搜索 Google 地图中的本地商家",
  query_label: "商家关键字",
  query_placeholder: "例如：牙医、意大利餐厅、水管工",
  query_hint: "输入要搜索的商家类型或名称",
  location_label: "位置",
  location_placeholder: "例如：纽约、伦敦、90210",
  location_hint: "输入城市、地址或邮编",
  max_results_label: "最大结果数",
  include_website: "包含网站",
  include_reviews: "包含评论",
  show_browser: "显示浏览器（调试）",
  start_search: "开始搜索",
  cancel_search: "取消",
  searching: "搜索中...",
  status_idle: "准备搜索",
  status_validating: "验证输入...",
  status_launching: "启动浏览器...",
  status_loading: "加载 Google 地图...",
  status_extracting: "提取商家信息 ({current}/{total})...",
  status_completed: "搜索完成",
  status_cancelled: "搜索已取消",
  status_failed: "搜索失败",
  status_timed_out: "搜索超时",
  no_results: "未找到商家",
  found_results: "在 '{location}' 找到 {count} 家 '{query}' 商家",
  col_name: "名称",
  col_category: "分类",
  col_rating: "评分",
  col_reviews: "评论数",
  col_address: "地址",
  col_phone: "电话",
  col_website: "网站",
  col_hours: "营业时间",
  export_csv: "导出 CSV",
  export_json: "导出 JSON",
  export_success: "导出成功",
  error_required: "关键字和位置为必填项",
  error_search_failed: "搜索失败：{error}",
  view_on_maps: "在 Google 地图中查看",
  reviews_count: "{count} 条评论",
},
```

**Spanish (es.ts)**:
```typescript
googleMaps: {
  title: "Buscador de Google Maps",
  description: "Busca empresas locales en Google Maps por palabra clave y ubicación",
  query_label: "Palabra clave",
  query_placeholder: "ej. dentista, restaurante italiano, fontanero",
  query_hint: "Introduce el tipo o nombre de negocio a buscar",
  location_label: "Ubicación",
  location_placeholder: "ej. Madrid, Barcelona, 28001",
  location_hint: "Introduce ciudad, dirección o código postal",
  max_results_label: "Resultados máximos",
  include_website: "Incluir sitio web",
  include_reviews: "Incluir reseñas",
  show_browser: "Mostrar navegador (Depuración)",
  start_search: "Buscar",
  cancel_search: "Cancelar",
  searching: "Buscando...",
  status_idle: "Listo para buscar",
  status_validating: "Validando entrada...",
  status_launching: "Iniciando navegador...",
  status_loading: "Cargando Google Maps...",
  status_extracting: "Extrayendo empresas ({current}/{total})...",
  status_completed: "Búsqueda completada",
  status_cancelled: "Búsqueda cancelada",
  status_failed: "Búsqueda fallida",
  status_timed_out: "Búsqueda agotada",
  no_results: "No se encontraron empresas",
  found_results: "Se encontraron {count} empresas para '{query}' en '{location}'",
  col_name: "Nombre",
  col_category: "Categoría",
  col_rating: "Calificación",
  col_reviews: "Reseñas",
  col_address: "Dirección",
  col_phone: "Teléfono",
  col_website: "Sitio web",
  col_hours: "Horario",
  export_csv: "Exportar CSV",
  export_json: "Exportar JSON",
  export_success: "Exportación exitosa",
  error_required: "Palabra clave y ubicación son obligatorias",
  error_search_failed: "Búsqueda fallida: {error}",
  view_on_maps: "Ver en Google Maps",
  reviews_count: "{count} reseñas",
},
```

**French (fr.ts)**:
```typescript
googleMaps: {
  title: "Scraper Google Maps",
  description: "Recherchez des entreprises locales sur Google Maps par mot-clé et lieu",
  query_label: "Mot-clé",
  query_placeholder: "ex. dentiste, restaurant italien, plombier",
  query_hint: "Entrez le type ou le nom d'entreprise à rechercher",
  location_label: "Lieu",
  location_placeholder: "ex. Paris, Lyon, 75001",
  location_hint: "Entrez une ville, adresse ou code postal",
  max_results_label: "Résultats maximum",
  include_website: "Inclure le site web",
  include_reviews: "Inclure les avis",
  show_browser: "Afficher le navigateur (Débogage)",
  start_search: "Rechercher",
  cancel_search: "Annuler",
  searching: "Recherche en cours...",
  status_idle: "Prêt à rechercher",
  status_validating: "Validation des entrées...",
  status_launching: "Lancement du navigateur...",
  status_loading: "Chargement de Google Maps...",
  status_extracting: "Extraction des entreprises ({current}/{total})...",
  status_completed: "Recherche terminée",
  status_cancelled: "Recherche annulée",
  status_failed: "Recherche échouée",
  status_timed_out: "Recherche expirée",
  no_results: "Aucune entreprise trouvée",
  found_results: "{count} entreprises trouvées pour '{query}' à '{location}'",
  col_name: "Nom",
  col_category: "Catégorie",
  col_rating: "Note",
  col_reviews: "Avis",
  col_address: "Adresse",
  col_phone: "Téléphone",
  col_website: "Site web",
  col_hours: "Horaires",
  export_csv: "Exporter CSV",
  export_json: "Exporter JSON",
  export_success: "Exportation réussie",
  error_required: "Mot-clé et lieu sont obligatoires",
  error_search_failed: "Recherche échouée : {error}",
  view_on_maps: "Voir sur Google Maps",
  reviews_count: "{count} avis",
},
```

**German (de.ts)**:
```typescript
googleMaps: {
  title: "Google Maps Scraper",
  description: "Suchen Sie lokale Unternehmen auf Google Maps nach Schlagwort und Standort",
  query_label: "Schlagwort",
  query_placeholder: "z.B. Zahnarzt, italienisches Restaurant, Klempner",
  query_hint: "Geben Sie den Typ oder Namen des Unternehmens ein",
  location_label: "Standort",
  location_placeholder: "z.B. Berlin, München, 10115",
  location_hint: "Stadt, Adresse oder Postleitzahl eingeben",
  max_results_label: "Maximale Ergebnisse",
  include_website: "Website einbeziehen",
  include_reviews: "Bewertungen einbeziehen",
  show_browser: "Browser anzeigen (Debug)",
  start_search: "Suchen",
  cancel_search: "Abbrechen",
  searching: "Suche läuft...",
  status_idle: "Bereit zur Suche",
  status_validating: "Eingabe wird validiert...",
  status_launching: "Browser wird gestartet...",
  status_loading: "Google Maps wird geladen...",
  status_extracting: "Unternehmen werden extrahiert ({current}/{total})...",
  status_completed: "Suche abgeschlossen",
  status_cancelled: "Suche abgebrochen",
  status_failed: "Suche fehlgeschlagen",
  status_timed_out: "Suche zeitüberschritten",
  no_results: "Keine Unternehmen gefunden",
  found_results: "{count} Unternehmen für '{query}' in '{location}' gefunden",
  col_name: "Name",
  col_category: "Kategorie",
  col_rating: "Bewertung",
  col_reviews: "Bewertungen",
  col_address: "Adresse",
  col_phone: "Telefon",
  col_website: "Website",
  col_hours: "Öffnungszeiten",
  export_csv: "CSV exportieren",
  export_json: "JSON exportieren",
  export_success: "Export erfolgreich",
  error_required: "Schlagwort und Standort sind erforderlich",
  error_search_failed: "Suche fehlgeschlagen: {error}",
  view_on_maps: "Auf Google Maps anzeigen",
  reviews_count: "{count} Bewertungen",
},
```

**Japanese (ja.ts)**:
```typescript
googleMaps: {
  title: "Google Maps スクレイパー",
  description: "キーワードと場所で Google Maps のローカルビジネスを検索",
  query_label: "ビジネスキーワード",
  query_placeholder: "例：歯科医院、イタリアンレストラン、配管工",
  query_hint: "検索するビジネスタイプまたは名前を入力",
  location_label: "場所",
  location_placeholder: "例：東京、大阪、100-0001",
  location_hint: "都市、住所、または郵便番号を入力",
  max_results_label: "最大結果数",
  include_website: "ウェブサイトを含む",
  include_reviews: "レビューを含む",
  show_browser: "ブラウザを表示（デバッグ）",
  start_search: "検索開始",
  cancel_search: "キャンセル",
  searching: "検索中...",
  status_idle: "検索準備完了",
  status_validating: "入力を検証中...",
  status_launching: "ブラウザを起動中...",
  status_loading: "Google Maps を読み込み中...",
  status_extracting: "ビジネス情報を抽出中 ({current}/{total})...",
  status_completed: "検索完了",
  status_cancelled: "検索をキャンセルしました",
  status_failed: "検索に失敗しました",
  status_timed_out: "検索がタイムアウトしました",
  no_results: "ビジネスが見つかりませんでした",
  found_results: "'{location}' の '{query}' で {count} 件のビジネスが見つかりました",
  col_name: "名前",
  col_category: "カテゴリ",
  col_rating: "評価",
  col_reviews: "レビュー数",
  col_address: "住所",
  col_phone: "電話番号",
  col_website: "ウェブサイト",
  col_hours: "営業時間",
  export_csv: "CSV エクスポート",
  export_json: "JSON エクスポート",
  export_success: "エクスポート成功",
  error_required: "キーワードと場所は必須です",
  error_search_failed: "検索に失敗しました：{error}",
  view_on_maps: "Google Maps で表示",
  reviews_count: "{count} 件のレビュー",
},
```

Also add route translation key `route.google_maps_scraper` with value "Google Maps Scraper" (en), "Google 地图抓取器" (zh), "Buscador de Google Maps" (es), "Scraper Google Maps" (fr), "Google Maps Scraper" (de), "Google Maps スクレイパー" (ja) in the `route` section of each language file.
</action>

<acceptance_criteria>
- All 6 language files contain `googleMaps` namespace with at least 30 keys each
- en.ts has English translations
- zh.ts has Chinese translations
- es.ts has Spanish translations
- fr.ts has French translations
- de.ts has German translations
- ja.ts has Japanese translations
- All files have matching key structure (no missing keys)
- Route key `route.google_maps_scraper` exists in all 6 files
- TypeScript compiles with no errors
</acceptance_criteria>

---

## Verification

1. Run `npx tsc --noEmit` — must pass with zero errors
2. Grep for `GOOGLE_MAPS_SEARCH_START` in channellist.ts — must exist
3. Grep for `registerGoogleMapsHandlers` in googleMaps-ipc.ts — must exist
4. Grep for `registerGoogleMapsHandlers` in background.ts — must be called
5. Grep for `google-maps-scraper` in router/index.ts — must find the route
6. Grep for `googleMaps:` in all 6 lang files — must find translations
7. Verify `src/views/pages/google-maps-scraper/index.vue` exists
8. Verify `src/views/api/googleMaps.ts` exists

## Must-Haves

- [ ] IPC handler starts search and pushes results via webContents.send
- [ ] IPC handler cancels search by requestId
- [ ] Frontend API wrapper has start, cancel, onResult functions
- [ ] Route `/google-maps-scraper` registered with visible=true
- [ ] Vue page has search form, progress, results table, export
- [ ] All 6 languages have complete googleMaps translations
- [ ] background.ts registers the Google Maps IPC handlers
- [ ] TypeScript compiles cleanly
