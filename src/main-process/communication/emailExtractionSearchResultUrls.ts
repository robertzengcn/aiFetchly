import type { SearchResEntity } from "@/entityTypes/scrapeType";
import { isValidUrl } from "@/views/utils/function";

export function resolveSearchResultUrls(results: SearchResEntity[]): string[] {
  return results
    .map((result) => result.link.trim())
    .filter((link) => isValidUrl(link));
}
