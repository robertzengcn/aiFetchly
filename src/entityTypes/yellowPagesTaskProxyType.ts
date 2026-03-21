/**
 * Proxy configuration persisted on Yellow Pages tasks and passed to the scraper child process.
 * Matches the shape saved from create.vue (`proxy_config`).
 */
export interface YellowPagesTaskProxyConfig {
  host: string;
  port: number;
  protocol: string;
  username?: string;
  password?: string;
}
