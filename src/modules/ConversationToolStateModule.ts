import { BaseModule } from "@/modules/baseModule";
import { ConversationToolStateModel } from "@/model/ConversationToolState.model";
import { ConversationToolStateEntity } from "@/entity/ConversationToolState.entity";
import type { ConversationToolStateView } from "@/entityTypes/toolCatalogTypes";

/**
 * Business logic for persisted per-conversation catalog state (design §19.3).
 *
 * Validates, dedupes, sorts, and drops stale names (names no longer present in
 * the current catalog) before persistence, and converts entity rows into views.
 */
export class ConversationToolStateModule extends BaseModule {
  private readonly model: ConversationToolStateModel;

  /**
   * @param dbpath Optional explicit db path for unit testing. Production
   * callers omit it and BaseModule resolves USERSDBPATH via Token.
   */
  constructor(dbpath?: string) {
    super();
    this.model = new ConversationToolStateModel(dbpath ?? this.dbpath);
  }

  async loadView(
    conversationId: string
  ): Promise<ConversationToolStateView | null> {
    await this.ensureConnection();
    const entity = await this.model.findByConversationId(conversationId);
    return entity ? entityToView(entity) : null;
  }

  async saveView(input: {
    readonly conversationId: string;
    readonly discoveredToolNames: readonly string[];
    readonly announcedDeferredToolNames: readonly string[];
    readonly catalogHash?: string;
    /** When provided, names not in this set are dropped as stale. */
    readonly knownToolNames?: ReadonlySet<string>;
  }): Promise<ConversationToolStateView> {
    await this.ensureConnection();
    const discovered = normalizeToolStateNames(
      input.discoveredToolNames,
      input.knownToolNames
    );
    const announced = normalizeToolStateNames(
      input.announcedDeferredToolNames,
      input.knownToolNames
    );
    const entity = await this.model.upsert({
      conversationId: input.conversationId,
      discoveredToolNamesJson: JSON.stringify(discovered),
      announcedDeferredToolNamesJson: JSON.stringify(announced),
      catalogHash: input.catalogHash,
    });
    return entityToView(entity);
  }

  async deleteByConversationId(conversationId: string): Promise<number> {
    await this.ensureConnection();
    return await this.model.deleteByConversationId(conversationId);
  }
}

/**
 * Validate, dedupe, optionally drop stale names, and sort a list of tool names.
 * Pure function — unit-tested without a database.
 */
export function normalizeToolStateNames(
  names: readonly unknown[],
  knownToolNames?: ReadonlySet<string>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name) continue;
    if (knownToolNames && !knownToolNames.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort();
}

export function entityToView(
  entity: ConversationToolStateEntity
): ConversationToolStateView {
  return {
    conversationId: entity.conversationId,
    discoveredToolNames: parseJsonStringArray(entity.discoveredToolNamesJson),
    announcedDeferredToolNames: parseJsonStringArray(
      entity.announcedDeferredToolNamesJson
    ),
    catalogHash: entity.catalogHash,
    updatedAt: entity.updatedAt
      ? new Date(entity.updatedAt).toISOString()
      : undefined,
  };
}

function parseJsonStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}
