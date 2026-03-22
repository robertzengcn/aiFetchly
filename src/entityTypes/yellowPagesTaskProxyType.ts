/**
 * Single endpoint for Puppeteer (`--proxy-server`). Used by the child scraper.
 */
export interface YellowPagesTaskProxyConfig {
  host: string;
  port: number;
  protocol: string;
  username?: string;
  password?: string;
}

/**
 * Persisted JSON in `yellow_pages_task.proxy_config`:
 * - **Preferred:** `{ proxies: YellowPagesTaskProxyConfig[] }` (UI multi-select).
 * - **Legacy:** a single `YellowPagesTaskProxyConfig` object at the root.
 * Runtime / launch uses the first valid entry in `proxies`, or the legacy root object.
 */
export type YellowPagesTaskProxyPersisted =
  | YellowPagesTaskProxyConfig
  | { proxies: YellowPagesTaskProxyConfig[] };
