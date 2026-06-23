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

function capString(
  value: unknown,
  max: number,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when present`);
  }
  if (value.length > max) {
    throw new Error(`${field} exceeded max length ${max}`);
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
    const out: HookOutput = {};

    if (obj.continue !== undefined) {
      if (typeof obj.continue !== "boolean") {
        throw new Error("continue must be a boolean when present");
      }
      out.continue = obj.continue;
    }

    out.reason = capString(obj.reason, MAX_REASON, "reason");

    out.systemMessage = capString(
      obj.systemMessage,
      MAX_SYS,
      "systemMessage"
    );

    if (obj.suppressOutput !== undefined) {
      if (typeof obj.suppressOutput !== "boolean") {
        throw new Error("suppressOutput must be a boolean when present");
      }
      out.suppressOutput = obj.suppressOutput;
    }

    if (obj.updatedInput !== undefined) {
      if (!isPlainObject(obj.updatedInput)) {
        throw new Error("updatedInput must be a non-null object");
      }
      if (utf8Bytes(obj.updatedInput) > MAX_IN_BYTES) {
        throw new Error("updatedInput exceeded max serialized size");
      }
      out.updatedInput = obj.updatedInput as Record<string, unknown>;
    }

    if (obj.updatedToolOutput !== undefined) {
      if (!isPlainObject(obj.updatedToolOutput)) {
        throw new Error("updatedToolOutput must be a non-null object");
      }
      if (utf8Bytes(obj.updatedToolOutput) > MAX_OUT_BYTES) {
        throw new Error("updatedToolOutput exceeded max serialized size");
      }
      out.updatedToolOutput = obj.updatedToolOutput as Record<string, unknown>;
    }

    out.additionalContext = capString(
      obj.additionalContext,
      MAX_CTX,
      "additionalContext"
    );

    if (obj.permissionDecision !== undefined) {
      if (!PERMISSION_DECISIONS.includes(obj.permissionDecision as HookPermissionDecision)) {
        throw new Error(
          "permissionDecision must be 'allow', 'ask', or 'deny' when present"
        );
      }
      out.permissionDecision = obj.permissionDecision as HookPermissionDecision;
    }

    return { valid: true, output: out };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}
