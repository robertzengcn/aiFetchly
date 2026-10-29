/**
 * Renderer-local selected-context item (technical-design §13.3).
 *
 * Single source of truth for the history-selection chip shape. Lives in a
 * plain `.ts` module (not a `.vue` SFC) so both renderer `.vue` components
 * (via `vue-tsc`) and plain `.ts` stores (via `tsc --noEmit` / the
 * main-process `vite-plugin-checker`) can import it: the `*.vue` shim used
 * by plain `tsc` only declares a default export, so named type imports from
 * `.vue` files fail there.
 *
 * Only the opaque `sourceId` is trusted across the renderer/main boundary;
 * `preview`/`estimatedTokens` are display-only (never re-sent as original
 * quotes). Fields are readonly — chips are replaced immutably
 * (`filter`/`map`/spread), never mutated in place, and the pinia store
 * clones each chip on the way in and out so no caller-held reference can
 * corrupt the drafts map.
 */
export interface SelectedContextItem {
  /** Opaque source id — the only value trusted across the boundary. */
  readonly sourceId: string;
  /** Short preview text for display only (never re-sent as original quote). */
  readonly preview: string;
  /** Estimated tokens for this selection (chars/4 heuristic). */
  readonly estimatedTokens: number;
  /** True when the backend re-resolution refreshed a stale reference. */
  readonly refreshed?: boolean;
  /** True when the backend rejected this source id (no longer available). */
  readonly rejected?: boolean;
}
