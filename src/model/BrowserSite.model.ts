import { BaseDb } from "./Basedb";
import { Repository } from "typeorm";
import { BrowserSiteEntity } from "@/entity/BrowserSite.entity";

/**
 * Browser site registry data access (PRD S-FR-01; technical design §15.1).
 * Database logic lives here — never in IPC handlers or worker code.
 */

/** First ID for AI/user-created sites (remote platform IDs stay below). */
export const BROWSER_SITE_AI_ID_BASE = 100000;

export interface BrowserSiteUpsertInput {
  readonly name: string;
  readonly url: string;
  readonly source?: "ai" | "user";
  readonly createdInConversationId?: string | null;
}

export interface BrowserSiteUpsertResult {
  readonly siteId: number;
  readonly registrableDomain: string;
  readonly status: string;
  readonly created: boolean;
}

export class BrowserSiteModel extends BaseDb {
  private repository: Repository<BrowserSiteEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<BrowserSiteEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(BrowserSiteEntity);
    }
    return this.repository;
  }

  async getSiteById(id: number): Promise<BrowserSiteEntity | null> {
    const repository = await this.getRepository();
    return await repository.findOne({ where: { id } });
  }

  async getSiteByRegistrableDomain(
    registrableDomain: string
  ): Promise<BrowserSiteEntity | null> {
    const repository = await this.getRepository();
    return await repository.findOne({
      where: { registrableDomain: registrableDomain.toLowerCase() },
    });
  }

  async listSites(): Promise<BrowserSiteEntity[]> {
    const repository = await this.getRepository();
    return await repository.find({ order: { id: "ASC" } });
  }

  /**
   * Insert a new site with an explicit ID (seeding keeps platform IDs).
   * Rejects a collision with an existing row (S-AC-01).
   */
  async insertSiteWithId(site: BrowserSiteEntity): Promise<BrowserSiteEntity> {
    const repository = await this.getRepository();
    const existing = await repository.findOne({ where: { id: site.id } });
    if (existing) {
      throw new Error("browser_site_id_collision");
    }
    return await repository.save(site);
  }

  /**
   * Allocate the next AI/user ID from the 100000 sequence. The module
   * dedupes by registrable domain first, so collisions are practically
   * impossible; the unique index is the final guard.
   */
  async nextAiSiteId(): Promise<number> {
    const repository = await this.getRepository();
    const rows = await repository
      .createQueryBuilder("site")
      .where("site.id >= :base", { base: BROWSER_SITE_AI_ID_BASE })
      .orderBy("site.id", "DESC")
      .take(1)
      .getMany();
    const highest = rows[0]?.id ?? BROWSER_SITE_AI_ID_BASE - 1;
    return Math.max(highest + 1, BROWSER_SITE_AI_ID_BASE);
  }

  async saveSite(site: BrowserSiteEntity): Promise<BrowserSiteEntity> {
    const repository = await this.getRepository();
    return await repository.save(site);
  }

  async countSites(): Promise<number> {
    const repository = await this.getRepository();
    return await repository.count();
  }
}
