import path from "path";
import type { GeneratedImageProtocolIdentity } from "@/entityTypes/generatedImageReferenceTypes";

export const AI_CHAT_GENERATED_IMAGE_PROTOCOL = "aifetchly-generated-image";
export const AI_CHAT_GENERATED_IMAGE_HOST = "local";
export const AI_CHAT_GENERATED_IMAGE_DIR = "ai-chat-generated-images";
const UNKNOWN_GENERATED_IMAGE_USER = "unknown-user";

export function getGeneratedImageRoot(userDataPath: string): string {
  return path.join(userDataPath, AI_CHAT_GENERATED_IMAGE_DIR);
}

export function normalizeGeneratedImageUserEmail(email: string): string {
  return (
    email
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._@+-]/g, "_")
      .slice(0, 160) || UNKNOWN_GENERATED_IMAGE_USER
  );
}

export function sanitizeGeneratedImagePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "unknown";
}

export function getGeneratedImageUserRoot(
  userDataPath: string,
  userEmail: string
): string {
  return path.join(
    getGeneratedImageRoot(userDataPath),
    normalizeGeneratedImageUserEmail(userEmail)
  );
}

export function buildGeneratedImageProtocolUrl(parts: {
  userEmail: string;
  conversationId: string;
  messageId: string;
  fileName: string;
}): string {
  const userEmail = encodeURIComponent(
    normalizeGeneratedImageUserEmail(parts.userEmail)
  );
  const conversationId = encodeURIComponent(parts.conversationId);
  const messageId = encodeURIComponent(parts.messageId);
  const fileName = encodeURIComponent(parts.fileName);
  return `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/${userEmail}/${conversationId}/${messageId}/${fileName}`;
}

export function resolveGeneratedImageProtocolPath(
  requestUrl: string,
  userDataPath: string
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}:` ||
    parsed.host !== AI_CHAT_GENERATED_IMAGE_HOST
  ) {
    return null;
  }
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (segments.length !== 4 || segments.some((segment) => segment.length === 0)) {
    return null;
  }
  const root = getGeneratedImageRoot(userDataPath);
  const candidate = path.resolve(root, ...segments);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

/**
 * Parses a generated-image protocol URL into a strict identity WITHOUT using
 * `new URL()`, which silently normalizes percent-encoding and dot segments.
 * Every returned path part is guaranteed sanitized and traversal-free.
 */
export function parseGeneratedImageProtocolIdentity(
  requestUrl: string,
  userDataPath: string
): GeneratedImageProtocolIdentity | null {
  const prefix = `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/`;
  if (requestUrl.includes("?") || requestUrl.includes("#")) {
    return null;
  }
  if (!requestUrl.startsWith(prefix)) {
    return null;
  }
  const rawSegments = requestUrl.slice(prefix.length).split("/");
  if (
    rawSegments.length !== 4 ||
    rawSegments.some((rawSegment) => rawSegment.length === 0)
  ) {
    return null;
  }
  const decodedSegments: string[] = [];
  for (const rawSegment of rawSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded === "." ||
      decoded === ".."
    ) {
      return null;
    }
    decodedSegments.push(decoded);
  }
  const normalizedUser = normalizeGeneratedImageUserEmail(decodedSegments[0]);
  if (decodedSegments[0] !== normalizedUser) {
    return null;
  }
  for (const decoded of decodedSegments.slice(1)) {
    if (decoded !== sanitizeGeneratedImagePathPart(decoded)) {
      return null;
    }
  }
  const candidatePath = path.resolve(
    getGeneratedImageUserRoot(userDataPath, normalizedUser),
    decodedSegments[1],
    decodedSegments[2],
    decodedSegments[3]
  );
  return {
    normalizedUser,
    conversationPathPart: decodedSegments[1],
    messagePathPart: decodedSegments[2],
    fileName: decodedSegments[3],
    candidatePath,
  };
}
