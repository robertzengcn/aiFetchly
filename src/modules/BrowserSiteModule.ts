import { BaseModule } from "@/modules/baseModule";
import {
  BrowserSiteModel,
  BROWSER_SITE_AI_ID_BASE,
  type BrowserSiteUpsertResult,
} from "@/model/BrowserSite.model";
import { BrowserSiteEntity } from "@/entity/BrowserSite.entity";
import { SocialPlatformList } from "@/config/generate";
import { PLATFORM_SESSION_MANIFEST } from "@/modules/PlatformSessionManifest";
import {
  parseUrlIdentity,
  hostnameAllowedBySuffixes,
} from "@/service/browserDecision/RegistrableDomain";
import { log } from "@/modules/Logger";

/**
 * Browser site registry module (PRD §6.9; technical design §15).
 *
 * Owns the database-backed site registry that replaces the hardcoded
 * platform lists. Seeded rows keep the existing platform IDs; AI/user
 * upserts allocate from 100000. Domain guardrails (S-FR-03/04):
 *  - HTTPS-only, registrable domains only (no public suffixes, IPs, or
 *    localhost outside tests);
 *  - dedupe by registrable domain;
 *  - a new site's allowed suffixes are exactly its registrable domain;
 *  - extra domains (SSO) can only be proposed from domains the session
 *    actually visited and always require user confirmation — an LLM
 *    argument can never widen the domain set.
 */

export interface SiteMatch {
  readonly siteId: number;
  readonly name: string;
  readonly registrableDomain: string;
  readonly allowedDomainSuffixes: readonly string[];
  readonly requiredDomainSuffixes: readonly string[];
  readonly loginUrl: string | null;
  readonly verificationUrl: string | null;
  readonly loginRecipe: string | null;
  readonly source: string;
  readonly status: string;
}

export interface SiteUpsertConfirmation {
  readonly siteId: number;
  readonly registrableDomain: string;
  readonly proposedDomains: readonly string[];
}

export class BrowserSiteModule extends BaseModule {
  private model: BrowserSiteModel | null = null;
  private seedPromise: Promise<void> | null = null;

  /**
   * Lazy one-time seeding (S-FR-02): the registry is populated from the
   * platform lists the first time any site lookup runs in this process.
   */
  private async ensureSeeded(): Promise<void> {
    if (!this.seedPromise) {
      this.seedPromise = this.seedFromPlatformLists()
        .then(() => undefined)
        .catch((error: unknown) => {
          log.warn(
            `[BrowserSiteModule] seeding failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
    }
    await this.seedPromise;
  }

  private async getModel(): Promise<BrowserSiteModel> {
    if (!this.model) {
      await this.ensureConnection();
      this.model = new BrowserSiteModel(this.dbpath);
    }
    return this.model;
  }

  /**
   * Seed the registry from SocialPlatformList + PLATFORM_SESSION_MANIFEST
   * with the SAME platform IDs (social_accounts.social_type_id references
   * them). Idempotent: existing registrable domains are left untouched.
   */
  public async seedFromPlatformLists(): Promise<number> {
    const model = await this.getModel();
    let inserted = 0;
    for (const platform of SocialPlatformList) {
      const identity = parseUrlIdentity(platform.url);
      if (!identity) {
        continue;
      }
      const existing =
        await model.getSiteByRegistrableDomain(identity.registrableDomain);
      if (existing) {
        continue;
      }
      const manifest = PLATFORM_SESSION_MANIFEST.find(
        (entry) => entry.platformId === platform.id
      );
      const entity = new BrowserSiteEntity();
      entity.id = platform.id;
      entity.name = platform.name;
      entity.homepageUrl = platform.url;
      entity.registrableDomain = identity.registrableDomain;
      entity.allowedDomainSuffixes = JSON.stringify(
        manifest
          ? [...manifest.allowedDomainSuffixes]
          : [identity.registrableDomain]
      );
      entity.requiredDomainSuffixes = JSON.stringify(
        manifest ? [...manifest.requiredDomainSuffixes] : []
      );
      entity.loginUrl = manifest?.loginUrl ?? platform.url;
      entity.verificationUrl = manifest?.verificationUrl ?? null;
      entity.browserProfileImportEnabled =
        manifest?.browserProfileImportEnabled ?? false;
      entity.source = "builtin";
      entity.status = "verified";
      await model.insertSiteWithId(entity);
      inserted++;
    }
    return inserted;
  }

  private async toMatch(entity: BrowserSiteEntity): Promise<SiteMatch> {
    return {
      siteId: entity.id,
      name: entity.name,
      registrableDomain: entity.registrableDomain,
      allowedDomainSuffixes: safeParseSuffixes(entity.allowedDomainSuffixes),
      requiredDomainSuffixes: safeParseSuffixes(entity.requiredDomainSuffixes),
      loginUrl: entity.loginUrl,
      verificationUrl: entity.verificationUrl,
      loginRecipe: entity.loginRecipe,
      source: entity.source,
      status: entity.status,
    };
  }

  /**
   * Match a LIVE page URL (never an LLM-claimed identity) to a site by
   * registrable domain, then confirm the exact hostname against the site's
   * allowed suffixes (A-FR-02, D-15).
   */
  public async matchByUrl(url: string): Promise<SiteMatch | null> {
    await this.ensureSeeded();
    const identity = parseUrlIdentity(url);
    if (!identity) {
      return null;
    }
    const model = await this.getModel();
    const entity = await model.getSiteByRegistrableDomain(
      identity.registrableDomain
    );
    if (entity) {
      const match = await this.toMatch(entity);
      if (
        hostnameAllowedBySuffixes(identity.hostname, match.allowedDomainSuffixes)
      ) {
        return match;
      }
    }
    // SSO/login redirects can land on a DIFFERENT registrable domain that
    // a site allowlists explicitly (e.g. youtube.com -> accounts.google.com).
    // Bounded fallback scan: hostname must match a site's allowed suffixes.
    const all = await model.listSites();
    for (const candidate of all) {
      if (candidate.registrableDomain === identity.registrableDomain) {
        continue;
      }
      const suffixes = safeParseSuffixes(candidate.allowedDomainSuffixes);
      if (hostnameAllowedBySuffixes(identity.hostname, suffixes)) {
        return this.toMatch(candidate);
      }
    }
    return null;
  }

  public async getSite(siteId: number): Promise<SiteMatch | null> {
    const model = await this.getModel();
    const entity = await model.getSiteById(siteId);
    return entity ? this.toMatch(entity) : null;
  }

  public async listSites(): Promise<SiteMatch[]> {
    const model = await this.getModel();
    const entities = await model.listSites();
    return Promise.all(entities.map((entity) => this.toMatch(entity)));
  }

  /**
   * S-FR-03: `browser_site_upsert(name, url)`. Creating a site restricted
   * to its own registrable domain happens automatically; extra domains are
   * NEVER accepted from the caller — they can only be proposed from domains
   * the session actually visited (S-FR-04) and need user confirmation.
   */
  public async upsertSite(input: {
    readonly name: string;
    readonly url: string;
    readonly source?: "ai" | "user";
    readonly createdInConversationId?: string | null;
  }): Promise<BrowserSiteUpsertResult> {
    await this.ensureSeeded();
    const identity = parseUrlIdentity(input.url);
    if (!identity) {
      throw new Error("invalid_site_url");
    }
    if (identity.protocol !== "https:") {
      throw new Error("https_required");
    }
    const model = await this.getModel();
    const existing = await model.getSiteByRegistrableDomain(
      identity.registrableDomain
    );
    if (existing) {
      return {
        siteId: existing.id,
        registrableDomain: existing.registrableDomain,
        status: existing.status,
        created: false,
      };
    }
    const entity = new BrowserSiteEntity();
    entity.id = await model.nextAiSiteId();
    entity.name = input.name.slice(0, 200);
    entity.homepageUrl = input.url;
    entity.registrableDomain = identity.registrableDomain;
    entity.allowedDomainSuffixes = JSON.stringify([
      identity.registrableDomain,
    ]);
    entity.requiredDomainSuffixes = JSON.stringify([]);
    entity.loginUrl = input.url;
    entity.source = input.source ?? "ai";
    entity.status = "unverified";
    entity.createdInConversationId = input.createdInConversationId ?? null;
    const saved = await model.saveSite(entity);
    log.info(
      `[BrowserSiteModule] site created id=${saved.id} domain=${identity.registrableDomain}`
    );
    return {
      siteId: saved.id,
      registrableDomain: saved.registrableDomain,
      status: saved.status,
      created: true,
    };
  }

  /**
   * S-FR-04: add domains the session ACTUALLY visited during the login
   * redirect. Requires user confirmation (returned here as a proposal; the
   * confirmation card applies it). A site with saved credentials always
   * needs confirmation, even for one domain.
   */
  public async proposeAdditionalDomains(input: {
    readonly siteId: number;
    readonly visitedDomains: readonly string[];
  }): Promise<SiteUpsertConfirmation | null> {
    const model = await this.getModel();
    const entity = await model.getSiteById(input.siteId);
    if (!entity) {
      return null;
    }
    const registrable = parseUrlIdentity(`https://${entity.registrableDomain}`);
    void registrable;
    const current = safeParseSuffixes(entity.allowedDomainSuffixes);
    const proposed = [
      ...new Set(
        input.visitedDomains
          .map((domain) => domain.trim().toLowerCase())
          .filter((domain) => domain && !current.includes(domain))
      ),
    ];
    if (proposed.length === 0) {
      return null;
    }
    return {
      siteId: entity.id,
      registrableDomain: entity.registrableDomain,
      proposedDomains: proposed,
    };
  }

  /** Apply a user-confirmed domain change (only from the confirmation card). */
  public async applyAdditionalDomains(input: {
    readonly siteId: number;
    readonly domains: readonly string[];
  }): Promise<boolean> {
    const model = await this.getModel();
    const entity = await model.getSiteById(input.siteId);
    if (!entity) {
      return false;
    }
    const current = safeParseSuffixes(entity.allowedDomainSuffixes);
    const merged = [...new Set([...current, ...input.domains.map((d) => d.toLowerCase())])];
    entity.allowedDomainSuffixes = JSON.stringify(merged);
    await model.saveSite(entity);
    return true;
  }

  /** Mark a site verified after a successful sign-in or user confirmation. */
  public async markVerified(siteId: number): Promise<boolean> {
    const model = await this.getModel();
    const entity = await model.getSiteById(siteId);
    if (!entity) {
      return false;
    }
    entity.status = "verified";
    await model.saveSite(entity);
    return true;
  }

  /** Save/replace the learned login recipe (technical design §14.3). */
  public async saveLoginRecipe(
    siteId: number,
    recipe: unknown
  ): Promise<boolean> {
    const model = await this.getModel();
    const entity = await model.getSiteById(siteId);
    if (!entity) {
      return false;
    }
    entity.loginRecipe = JSON.stringify(recipe);
    await model.saveSite(entity);
    return true;
  }

  public static aiIdBase(): number {
    return BROWSER_SITE_AI_ID_BASE;
  }
}

function safeParseSuffixes(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is string => typeof entry === "string"
      );
    }
    return [];
  } catch {
    return [];
  }
}

let defaultModule: BrowserSiteModule | null = null;

export function getDefaultBrowserSiteModule(): BrowserSiteModule {
  if (!defaultModule) {
    defaultModule = new BrowserSiteModule();
  }
  return defaultModule;
}
