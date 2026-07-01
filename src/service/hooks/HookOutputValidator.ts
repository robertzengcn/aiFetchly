import {
  HOOK_LIMITS,
  HookOutput,
  HookPermissionDecision,
} from "@/entityTypes/hookTypes";

export type HookOutputValidationResult =
  | { readonly valid: true; readonly output: HookOutput }
  | { readonly valid: false; readonly error: string };

const PERMISSION_DECISIONS: readonly HookPermissionDecision[] = [
  "allow",
  "ask",
  "deny",
];

const MAX_REASON = HOOK_LIMITS.maxReasonChars;
const MAX_SYS = HOOK_LIMITS.maxSystemMessageChars;
const MAX_CTX = HOOK_LIMITS.maxAdditionalContextChars;
const MAX_IN_BYTES = HOOK_LIMITS.maxUpdatedInputBytes;
const MAX_OUT_BYTES = HOOK_LIMITS.maxUpdatedToolOutputBytes;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  // Reject arrays and class instances; only accept plain object literals.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return true;
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

class ValidationError extends Error {}

function capString(
  value: unknown,
  max: number,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string when present`);
  }
  if (value.length > max) {
    throw new ValidationError(`${field} exceeded max length ${max}`);
  }
  return value;
}

/**
 * Validate untrusted hook output (from command hooks) and trusted
 * callback output alike. Rejects malformed shape, oversized strings,
 * non-object updates, and invalid permission decisions. Unknown fields
 * are ignored.
 */
export function validateHookOutput(
  raw: unknown
): HookOutputValidationResult {
  if (!isPlainObject(raw)) {
    return { valid: false, error: "Hook output must be a plain object" };
  }
  const obj = raw as Record<string, unknown>;

  try {
    const output: HookOutput = {
      ...(obj.continue !== undefined
        ? pickBoolean(obj.continue, "continue")
        : {}),
      ...(obj.reason !== undefined
        ? { reason: capString(obj.reason, MAX_REASON, "reason") }
        : {}),
      ...(obj.systemMessage !== undefined
        ? { systemMessage: capString(obj.systemMessage, MAX_SYS, "systemMessage") }
        : {}),
      ...(obj.suppressOutput !== undefined
        ? pickBoolean(obj.suppressOutput, "suppressOutput")
        : {}),
      ...(obj.updatedInput !== undefined
        ? pickObject(obj.updatedInput, "updatedInput", MAX_IN_BYTES)
        : {}),
      ...(obj.updatedToolOutput !== undefined
        ? pickObject(obj.updatedToolOutput, "updatedToolOutput", MAX_OUT_BYTES)
        : {}),
      ...(obj.additionalContext !== undefined
        ? {
            additionalContext: capString(
              obj.additionalContext,
              MAX_CTX,
              "additionalContext"
            ),
          }
        : {}),
      ...(obj.permissionDecision !== undefined
        ? pickPermission(obj.permissionDecision)
        : {}),
    };
    return { valid: true, output };
  } catch (err) {
    const message =
      err instanceof ValidationError ? err.message : String(err);
    return { valid: false, error: message };
  }
}

function pickBoolean(
  value: unknown,
  field: string
): { [K in typeof field]: boolean } {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${field} must be a boolean when present`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { [field]: value } as any;
}

function pickObject(
  value: unknown,
  field: string,
  maxBytes: number
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ValidationError(`${field} must be a non-null object`);
  }
  if (utf8Bytes(value) > maxBytes) {
    throw new ValidationError(`${field} exceeded max serialized size`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { [field]: value } as any;
}

function pickPermission(
  value: unknown
): { permissionDecision: HookPermissionDecision } {
  if (!PERMISSION_DECISIONS.includes(value as HookPermissionDecision)) {
    throw new ValidationError(
      "permissionDecision must be 'allow', 'ask', or 'deny' when present"
    );
  }
  return { permissionDecision: value as HookPermissionDecision };
}
