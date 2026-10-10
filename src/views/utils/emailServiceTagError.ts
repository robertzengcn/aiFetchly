export function emailServiceTagErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const codes: Record<string, string> = {
    EMAIL_SERVICE_TAG_REQUIRED: "tag_required",
    EMAIL_SERVICE_TAG_TOO_LONG: "tag_too_long",
    EMAIL_SERVICE_TAG_INVALID_CHARACTERS: "tag_invalid_characters",
    EMAIL_SERVICE_TAG_DUPLICATE: "tag_duplicate",
    EMAIL_SERVICE_TAG_NOT_FOUND: "tag_not_found",
  };
  const code = Object.keys(codes).find((value) => message.includes(value));
  return `emailservice.${code ? codes[code] : "tag_operation_failed"}`;
}
