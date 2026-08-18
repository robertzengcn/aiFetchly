/**
 * Public, non-secret application identity constants.
 *
 * These describe the product to the user (About page, website link) and to the
 * GitHub auto-update feed. They contain no credentials and are safe to import
 * from either the renderer or the main process.
 */

/** Official product / company website opened from the About page. */
export const AIFETCHLY_WEBSITE_URL = 'https://www.sellart-online.com';

/**
 * GitHub repository that hosts Releases consumed by `update-electron-app`
 * via the public `https://update.electronjs.org` feed.
 */
export const AIFETCHLY_UPDATE_REPO = 'robertzengcn/aiFetchly';

/**
 * Interval between automatic background update checks. `update-electron-app`
 * enforces a 5 minute minimum.
 */
export const AIFETCHLY_UPDATE_INTERVAL = '1 hour';
