import { PlatformConfig } from "@/modules/interface/IPlatformConfig";

/**
 * Normalize a platform reference for tolerant comparison.
 *
 * Users and AI models frequently pass a platform identifier in a slightly
 * different shape than the canonical config value, e.g.:
 *   - URL-ish form:   `yellowpages.com`
 *   - display form:   `YellowPages.com`
 *   - dashed id form: `yellowpages-com`
 *
 * To avoid "Platform '...' not found" failures, we lower-case the input and
 * treat `-`, `.` and whitespace as interchangeable separators before
 * comparing against each platform's `id`, `name` and `display_name`.
 */
function normalizeReference(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-.\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Find a platform config from a free-form reference string.
 *
 * Comparison is case-insensitive and treats `-`, `.`, whitespace and `_` as
 * equivalent separators, so `yellowpages.com`, `YellowPages.com`,
 * `yellowpages-com` and `yellowpages com` all resolve to the same platform.
 *
 * @param platforms All registered platform configs.
 * @param ref The platform identifier supplied by a caller or AI model.
 * @returns The matching platform config, or `undefined` when nothing matches.
 */
export function findPlatformByReference(
  platforms: PlatformConfig[],
  ref: string
): PlatformConfig | undefined {
  const needle = normalizeReference(ref);
  if (needle.length === 0) {
    return undefined;
  }

  return platforms.find((p) => {
    const candidates = [p.id, p.name, p.display_name];
    return candidates.some(
      (candidate) =>
        typeof candidate === "string" &&
        normalizeReference(candidate) === needle
    );
  });
}