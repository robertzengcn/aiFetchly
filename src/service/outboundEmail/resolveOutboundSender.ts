import { EmailServiceModel } from "@/model/EmailService.model";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

/** Full identity result (§13.2): authentication + visible + reply identities. */
export interface ResolvedOutboundIdentity {
  readonly emailServiceId: number;
  readonly smtpUsername: string;
  readonly senderAddress: string;
  readonly replyToAddress: string | null;
}

export interface ResolveOutboundSenderOptions {
  readonly dbpath: string;
  /** Prefer this service (the revision's frozen emailServiceId) when set. */
  readonly preferredServiceId?: number | null;
  /** Candidate service IDs from the tool args / batch row. */
  readonly serviceIds?: ReadonlyArray<number>;
}

/**
 * Coerce tool/IPC service id values into a de-duplicated list of positive
 * integers. Accepts a single number, an array, or numeric strings so a model
 * that passes `service_ids: 3` or `["3"]` still binds a real sender.
 */
export function normalizeEmailServiceIds(raw: unknown): number[] {
  if (raw == null || raw === "") {
    return [];
  }
  const values: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.includes(",")
    ? raw.split(",")
    : [raw];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) {
      continue;
    }
    seen.add(n);
    ids.push(n);
  }
  return ids;
}

/**
 * Resolve the full effective identity for the preferred/candidate services,
 * falling back to the first active service with a non-empty From. Returns
 * null when nothing usable is configured — callers must fail closed.
 */
export async function resolveOutboundIdentity(
  options: ResolveOutboundSenderOptions
): Promise<ResolvedOutboundIdentity | null> {
  const model = new EmailServiceModel(options.dbpath);
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  const pushId = (id: number | null | undefined): void => {
    if (id == null || !Number.isInteger(id) || id <= 0 || seen.has(id)) {
      return;
    }
    seen.add(id);
    orderedIds.push(id);
  };
  pushId(options.preferredServiceId ?? null);
  for (const id of options.serviceIds ?? []) {
    pushId(id);
  }

  const resolveOne = async (
    id: number
  ): Promise<ResolvedOutboundIdentity | null> => {
    const raw = await model.readIdentity(id);
    if (!raw || !raw.from) return null;
    const identity = resolveEmailServiceIdentity({
      smtpUsername: raw.smtpUsername,
      from: raw.from,
      replyTo: raw.replyTo,
    });
    return {
      emailServiceId: id,
      smtpUsername: identity.smtpUsername,
      senderAddress: identity.fromAddress,
      replyToAddress: identity.replyToAddress,
    };
  };

  for (const id of orderedIds) {
    const resolved = await resolveOne(id);
    if (resolved) return resolved;
  }

  const listed = await model.listEmailServices(0, 1000);
  for (const service of listed) {
    if (service.status !== 1 || seen.has(service.id)) {
      continue;
    }
    const resolved = await resolveOne(service.id);
    if (resolved) return resolved;
  }
  return null;
}
