import * as fs from "fs";
import * as path from "path";
import type {
  PluginMarketplaceError,
  PluginMarketplaceSource,
  PluginMarketplaceSourceKind,
} from "@/entityTypes/pluginMarketplaceTypes";

export type ParseSourceResult =
  | { success: true; source: PluginMarketplaceSource }
  | { success: false; errors: PluginMarketplaceError[] };

function err(message: string): PluginMarketplaceError {
  return { code: "marketplace-source-invalid", message, recoverable: false };
}

function containsControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 10 || code === 13 || code <= 31) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a user-provided marketplace source string into a structured source.
 * Rules: trim; reject empty / control chars; classify by shape; resolve
 * relative local paths to absolute.
 */
export function parseMarketplaceSource(raw: string, ref?: string): ParseSourceResult {
  const input = (raw ?? "").trim();
  if (input.length === 0) {
    return { success: false, errors: [err("Marketplace source is empty.")] };
  }
  if (containsControlCharacter(input)) {
    return { success: false, errors: [err("Marketplace source contains control characters.")] };
  }
  if (ref && containsControlCharacter(ref)) {
    return { success: false, errors: [err("Marketplace ref contains control characters.")] };
  }

  const withRef = (kind: PluginMarketplaceSourceKind, uri: string): PluginMarketplaceSource => ({
    kind,
    uri,
    ...(ref ? { ref } : {}),
  });

  // Plain http:// is always rejected.
  if (input.startsWith("http://")) {
    return { success: false, errors: [err("Plain HTTP marketplace sources are not allowed. Use HTTPS.")] };
  }

  // git@ ssh style
  if (input.startsWith("git@")) {
    return { success: true, source: withRef("git", input) };
  }

  // https:// ... .git
  if (input.startsWith("https://") && input.endsWith(".git")) {
    return { success: true, source: withRef("git", input) };
  }

  // ssh:// or git://
  if (input.startsWith("ssh://") || input.startsWith("git://")) {
    return { success: true, source: withRef("git", input) };
  }

  // GitHub shorthand owner/repo (no slashes elsewhere, no spaces).
  if (/^[a-z0-9][a-z0-9.-]*\/[a-z0-9_.-]+$/i.test(input) && !input.includes("://")) {
    return { success: true, source: withRef("github", input) };
  }

  // https://.../marketplace.json (direct URL)
  if (input.startsWith("https://") && /marketplace\.json(\?.*)?$/i.test(input)) {
    return { success: true, source: withRef("url", input) };
  }

  // Local existing file named marketplace.json
  try {
    const abs = path.resolve(input);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile() && input.toLowerCase().endsWith("marketplace.json")) {
      return { success: true, source: withRef("local-file", abs) };
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      return { success: true, source: withRef("local-folder", abs) };
    }
  } catch {
    // fall through to ambiguous error
  }

  // Ambiguous https URL (not .git, not marketplace.json)
  if (input.startsWith("https://")) {
    return {
      success: false,
      errors: [
        err(
          "Ambiguous HTTPS source. Use a URL ending in .git or a direct marketplace.json URL."
        ),
      ],
    };
  }

  return { success: false, errors: [err(`Unrecognized marketplace source: "${input}".`)] };
}
