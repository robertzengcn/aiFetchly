import { EmailServiceModel } from "@/model/EmailService.model";

/**
 * Resolve the frozen envelope sender from configured SMTP services
 * (AD-005/AD-006). The model never supplies the sender; trusted app code
 * binds `email_service.from` (legacy rows: `from_email`) into the hash
 * before review/authorization.
 */

export interface ResolvedOutboundSender {
  readonly emailServiceId: number;
  readonly senderAddress: string;
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
    const n =
      typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) {
      continue;
    }
    seen.add(n);
    ids.push(n);
  }
  return ids;
}

/**
 * Look up the envelope sender for the preferred/candidate services, then
 * fall back to the first active SMTP service with a non-empty from-address.
 * Returns null when nothing usable is configured — callers must fail closed.
 */
export async function resolveOutboundSender(
  options: ResolveOutboundSenderOptions
): Promise<ResolvedOutboundSender | null> {
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

  for (const id of orderedIds) {
    const senderAddress = await model.readSenderAddress(id);
    if (senderAddress) {
      return { emailServiceId: id, senderAddress };
    }
  }

  const listed = await model.listEmailServices(0, 1000);
  for (const service of listed) {
    if (service.status !== 1 || seen.has(service.id)) {
      continue;
    }
    const senderAddress = await model.readSenderAddress(service.id);
    if (senderAddress) {
      return { emailServiceId: service.id, senderAddress };
    }
  }
  return null;
}
