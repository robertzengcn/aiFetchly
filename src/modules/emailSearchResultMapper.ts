import {
  AiEnrichmentStatus,
  EmailResult,
  EmailResultDisplay,
} from "@/entityTypes/emailextraction-type";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";

type DisplayBuildOptions = {
  formatDateTime: (date: Date) => string;
};

export function buildEmailSearchResultEntity(
  taskId: number,
  result: EmailResult
): EmailSearchResultEntity {
  const url = new URL(result.url);
  const entity = new EmailSearchResultEntity();
  entity.task_id = taskId;
  entity.url = url.hostname;
  entity.title = result.pageTitle;

  if (result.aiEnrichment) {
    entity.phone = result.aiEnrichment.phone ?? null;
    entity.address = result.aiEnrichment.address ?? null;
    entity.socialLinks = result.aiEnrichment.socialLinks
      ? JSON.stringify(result.aiEnrichment.socialLinks)
      : null;
    entity.aiEnrichmentStatus = result.aiEnrichment.status;
    entity.aiEnrichmentError = result.aiEnrichment.error ?? null;
    entity.aiConfidence = result.aiEnrichment.confidence ?? 0;
  } else {
    entity.aiEnrichmentStatus = "none";
  }

  return entity;
}

export function buildEmailResultDisplay(
  entity: EmailSearchResultEntity,
  emails: string[],
  options: DisplayBuildOptions
): EmailResultDisplay {
  return {
    id: entity.id ?? 0,
    url: entity.url,
    pageTitle: entity.title ?? "",
    emails,
    recordTime: entity.createdAt ? options.formatDateTime(entity.createdAt) : "",
    phone: entity.phone ?? undefined,
    address: entity.address ?? undefined,
    socialLinks: parseSocialLinks(entity.socialLinks),
    aiEnrichmentStatus: normalizeAiEnrichmentStatus(entity.aiEnrichmentStatus),
    aiConfidence: entity.aiConfidence ?? undefined,
  };
}

function parseSocialLinks(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return undefined;
}

function normalizeAiEnrichmentStatus(
  status: string | null
): AiEnrichmentStatus {
  switch (status) {
    case "pending":
    case "completed":
    case "failed":
    case "skipped":
      return status;
    case "none":
    default:
      return "none";
  }
}
