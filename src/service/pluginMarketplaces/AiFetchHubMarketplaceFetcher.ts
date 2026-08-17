import { z } from "zod/v4";
import { HttpClient } from "@/modules/lib/httpclient";
import {
  HUB_MARKETPLACE_DISPLAY_NAME,
  HUB_MARKETPLACE_NAME,
  PLUGIN_HUB_CATALOG_PATH,
  resolvePluginHubBase,
} from "@/config/pluginHubUrl";
import type { PluginCommunityAccess } from "@/entityTypes/communityPluginTypes";
import type { PluginMarketplaceEntrySource } from "@/entityTypes/pluginMarketplaceTypes";
import {
  mktErr,
  type PluginMarketplaceFetchResult,
  type PluginMarketplaceFetcher,
  type PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";

const TIMEOUT_MS = 10_000;
const MAX_PLUGINS = 5000;

/** Minimal client surface the fetcher needs (doubles as the test seam). */
export type HubCatalogClient = Pick<HttpClient, "getFirstParty">;

// --- Hub catalog contract (first-party; PRD §7.4 / hub tech design §9.3) ----

const accessSchema = z
  .object({
    status: z.enum([
      "allowed",
      "login_required",
      "subscription_required",
      "forbidden",
      "unavailable",
    ]),
    installMode: z.enum(["direct", "ticket"]),
  })
  .passthrough();

/**
 * Direct-install source descriptors. The hub emits marketplace-shaped
 * objects ({source:"github",repo} etc.); a generic {kind,uri,ref} form is
 * tolerated and normalized (tech design §18.3).
 */
const entrySourceSchema = z.union([
  z
    .object({
      source: z.literal("github"),
      repo: z.string().min(1).max(512),
      ref: z.string().max(256).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("url"),
      url: z.string().min(1).max(4096),
      ref: z.string().max(256).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("npm"),
      package: z.string().min(1).max(512),
      version: z.string().max(256).optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.enum(["github", "git", "url", "npm"]),
      uri: z.string().min(1).max(4096),
      ref: z.string().max(256).optional(),
    })
    .passthrough(),
]);

const hubEntrySchema = z
  .object({
    slug: z.string().min(1).max(256),
    displayName: z.string().max(256).optional(),
    name: z.string().max(256).optional(),
    description: z.string().max(2048).optional(),
    version: z.string().max(128).optional(),
    owner: z.string().max(256).optional(),
    category: z.string().max(128).optional(),
    tags: z.array(z.string().max(64)).max(64).optional(),
    homepage: z.string().max(2048).optional(),
    repository: z.string().max(2048).optional(),
    license: z.string().max(128).optional(),
    access: accessSchema,
    source: entrySourceSchema.optional(),
  })
  .passthrough();

const hubCatalogSchema = z
  .object({
    plugins: z.array(hubEntrySchema).max(MAX_PLUGINS),
    segment: z.string().max(64).optional(),
  })
  .passthrough();

type HubEntry = z.infer<typeof hubEntrySchema>;
type HubEntrySource = z.infer<typeof entrySourceSchema>;

/** Marketplace-shaped output of normalizeEntrySource (object variants only). */
type NormalizedEntrySource = Extract<
  PluginMarketplaceEntrySource,
  { source: string }
>;

/** Normalize a hub source descriptor into a marketplace entry source. */
function normalizeEntrySource(
  raw: HubEntrySource
): NormalizedEntrySource | undefined {
  // Passthrough unions narrow poorly under `in`; probe by runtime field type.
  const r = raw as Record<string, unknown>;
  if (typeof r.source === "string") {
    // Rebuild from validated fields only — do NOT return the passthrough
    // object, whose undeclared keys would smuggle unvalidated values
    // (e.g. registry/sha) into the install pipeline's CLI arguments.
    const ref = typeof r.ref === "string" ? r.ref : undefined;
    const sha = typeof r.sha === "string" ? r.sha : undefined;
    const pinned = sha ?? ref;
    if (
      r.source === "github" &&
      typeof r.repo === "string" &&
      r.repo.length > 0
    ) {
      return {
        source: "github",
        repo: r.repo,
        ...(pinned ? { ref: pinned } : {}),
      };
    }
    if (r.source === "url" && typeof r.url === "string" && r.url.length > 0) {
      return { source: "url", url: r.url, ...(pinned ? { ref: pinned } : {}) };
    }
    if (
      r.source === "npm" &&
      typeof r.package === "string" &&
      r.package.length > 0
    ) {
      return {
        source: "npm",
        package: r.package,
        ...(typeof r.version === "string" && r.version.length > 0
          ? { version: r.version }
          : {}),
      };
    }
    return undefined;
  }
  const uri = typeof r.uri === "string" ? r.uri : "";
  const ref = typeof r.ref === "string" ? r.ref : undefined;
  switch (r.kind) {
    case "github": {
      const match = uri.match(
        /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i
      );
      return match
        ? { source: "github", repo: match[1], ...(ref ? { ref } : {}) }
        : undefined;
    }
    case "npm":
      return { source: "npm", package: uri };
    case "git":
    case "url":
    default:
      return { source: "url", url: uri, ...(ref ? { ref } : {}) };
  }
}

/**
 * First-party AiFetchly Plugin Hub marketplace fetcher.
 *
 * Unlike user-added marketplaces, the hub URL comes ONLY from
 * resolvePluginHubBase() (build-time first-party constant) — `req.source.uri`
 * is deliberately ignored, so a tampered marketplace row cannot redirect hub
 * traffic (and the marketing JWT) to another origin. Auth + 401-refresh are
 * handled by HttpClient.getFirstParty.
 */
export class AiFetchHubMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "aifetch-hub" as const;

  constructor(
    private readonly clientFactory: () => HubCatalogClient = () =>
      new HttpClient()
  ) {}

  async fetch(
    req: PluginMarketplaceFetchRequest
  ): Promise<PluginMarketplaceFetchResult> {
    void req; // source.uri intentionally ignored — see class doc.
    const base = resolvePluginHubBase().value;

    let parsedBase: URL;
    try {
      parsedBase = new URL(base);
    } catch {
      return fail("marketplace-source-invalid", "Invalid Plugin Hub URL.");
    }
    const isLocalDev =
      parsedBase.protocol === "http:" &&
      (parsedBase.hostname === "localhost" ||
        parsedBase.hostname === "127.0.0.1");
    if (parsedBase.protocol !== "https:" && !isLocalDev) {
      return fail(
        "marketplace-source-invalid",
        "Plugin Hub URL must be https (or localhost for dev)."
      );
    }

    const url = base + PLUGIN_HUB_CATALOG_PATH;
    try {
      const client = this.clientFactory();
      const raw = await client.getFirstParty<unknown>(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const parsed = hubCatalogSchema.safeParse(raw);
      if (!parsed.success) {
        const msg = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return fail(
          "marketplace-fetch-failed",
          `Plugin Hub catalog is invalid: ${msg}`
        );
      }

      const plugins = parsed.data.plugins.map((entry) =>
        toManifestEntry(entry)
      );
      const manifestJson = JSON.stringify({
        name: HUB_MARKETPLACE_NAME,
        owner: { name: HUB_MARKETPLACE_DISPLAY_NAME },
        description: "AiFetchly community plugin catalog",
        plugins,
      });
      return {
        success: true,
        marketplace: {
          // In-memory manifest: the hub response never materializes as a
          // marketplace cache dir. The service persists manifestJson only.
          marketplaceRoot: "",
          manifestPath: "",
          manifestJson,
          cleanup: async () => undefined,
        },
      };
    } catch (err) {
      return fail(
        "marketplace-fetch-failed",
        err instanceof Error
          ? err.message
          : "Failed to fetch Plugin Hub catalog."
      );
    }
  }
}

function toManifestEntry(entry: HubEntry): Record<string, unknown> {
  const source = entry.source ? normalizeEntrySource(entry.source) : undefined;
  return {
    name: entry.slug, // marketplace canonical name = hub slug
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.tags ? { tags: entry.tags } : {}),
    ...(entry.homepage ? { homepage: entry.homepage } : {}),
    ...(entry.repository ? { repository: entry.repository } : {}),
    ...(entry.license ? { license: entry.license } : {}),
    ...(source ? { source } : {}),
    // Hub passthrough extras consumed by the community page/service.
    slug: entry.slug,
    access: {
      status: entry.access.status,
      installMode: entry.access.installMode,
    } satisfies PluginCommunityAccess,
    ...(entry.owner ? { owner: entry.owner } : {}),
  };
}

function fail(
  code: "marketplace-source-invalid" | "marketplace-fetch-failed",
  message: string
): PluginMarketplaceFetchResult {
  return { success: false, errors: [mktErr(code, message)] };
}
