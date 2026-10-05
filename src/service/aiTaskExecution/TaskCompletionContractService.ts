/**
 * Freezes a completion contract from the objective + approved sources
 * (technical-design §5.1, FR-19).
 *
 * The contract hash is computed over a canonical JSON form of the
 * objective, criteria, and approved source IDs — EXCLUDING volatile
 * execution/provider IDs — so an unchanged Continue contract remains
 * comparable (§5.1). Source references must point only at messages in
 * `approvedSourceMessageIds`; runtime nudges/retrieved instructions can
 * never authorize work (FR-18).
 *
 * A verified-mode contract with zero required criteria cannot pass vacuously
 * (FR-04); freeze throws. Best-effort with zero criteria is allowed and
 * remains unverified unless evidence establishes every required criterion.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  taskCompletionContractSchema,
  type TaskCompletionContract,
  type TaskCriterion,
} from "@/entityTypes/aiTaskExecutionTypes";

export interface FreezeInput {
  readonly objective: string;
  readonly sourceUserMessageId: string;
  readonly approvedSourceMessageIds: readonly string[];
  readonly mode: "verified" | "best_effort";
  readonly criteria: readonly TaskCriterion[];
}

function canonicalJson(value: unknown): string {
  // Deterministic serialization: sort object keys recursively so the hash is
  // stable regardless of insertion order. Excludes volatile IDs by
  // construction (callers pass only objective/criteria/sources).
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Use a null-prototype object so assigning to an `__proto__` key
    // (present as an own key on JSON.parse'd untrusted input) cannot mutate
    // the prototype chain of the intermediate sorted object. Skipping
    // `constructor`/`hasOwnProperty` defensively too.
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(obj).sort()) {
      if (key === "__proto__" || key === "constructor" || key === "hasOwnProperty") {
        continue;
      }
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export class TaskCompletionContractService {
  freeze(input: FreezeInput): TaskCompletionContract {
    // Validate source references (FR-18): every criterion's sourceRefs must
    // point at an approved source message. SourceUserMessageId must itself
    // be in the approved set.
    const approvedSet = new Set(input.approvedSourceMessageIds);
    if (!approvedSet.has(input.sourceUserMessageId)) {
      throw new Error(
        "sourceUserMessageId must be in approvedSourceMessageIds"
      );
    }
    for (const criterion of input.criteria) {
      for (const ref of criterion.sourceRefs) {
        if (!approvedSet.has(ref.messageId)) {
          throw new Error(
            `criterion ${criterion.id} references unapproved message ${ref.messageId}`
          );
        }
        if (ref.endOffset < ref.startOffset) {
          throw new Error(
            `criterion ${criterion.id} has invalid offset range`
          );
        }
      }
    }

    // FR-04: a verified-mode contract with zero required criteria cannot
    // pass vacuously. Block at freeze time.
    if (
      input.mode === "verified" &&
      input.criteria.filter((c) => c.required).length === 0
    ) {
      throw new Error(
        "verified contract requires at least one required criterion"
      );
    }

    const contractId = `contract-${randomUUID()}`;
    const contractHash = this.computeHash(input);
    const contract: TaskCompletionContract = {
      schemaVersion: 1,
      contractId,
      contractHash,
      objective: input.objective,
      sourceUserMessageId: input.sourceUserMessageId,
      approvedSourceMessageIds: [...input.approvedSourceMessageIds],
      mode: input.mode,
      // Deep-copy each criterion: `sourceRefs` (all variants), plus
      // `requiredContentChecks` (artifact) and `sourceSelectorKeys`
      // (qualitative) are nested arrays. A shallow `.map((c) => ({ ...c }))`
      // would share those arrays by reference, so a post-freeze caller
      // mutation would silently alter the frozen contract and cause
      // `verifyHash` to return false for an untampered contract. A full
      // `structuredClone` deep-copies all plain-data nested arrays in one
      // call and keeps the frozen contract independent of caller state.
      criteria: input.criteria.map((c) => structuredClone(c)),
    };
    // Schema-validate the frozen output so contracts the schema rejects
    // (empty objective, negative offsets, overlong fields, duplicate criterion
    // IDs) never leave freeze(). The ad-hoc checks above catch only the
    // common cases; this is the boundary the type system and downstream
    // loaders will enforce.
    taskCompletionContractSchema.parse(contract);
    return contract;
  }

  /** Recompute the hash for an existing contract to verify integrity on load. */
  verifyHash(contract: TaskCompletionContract): boolean {
    const recomputed = this.computeHash({
      objective: contract.objective,
      sourceUserMessageId: contract.sourceUserMessageId,
      approvedSourceMessageIds: contract.approvedSourceMessageIds,
      mode: contract.mode,
      criteria: contract.criteria,
    });
    return recomputed === contract.contractHash;
  }

  private computeHash(input: FreezeInput): string {
    // Sort criteria by id so two contracts with the same criteria in different
    // array order hash identically (§5.1: "an unchanged Continue contract
    // remains comparable"). Without this, reordering criteria silently
    // produces a different hash, defeating scope-change detection.
    const sortedCriteria = [...input.criteria]
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const payload = {
      objective: input.objective,
      mode: input.mode,
      sourceUserMessageId: input.sourceUserMessageId,
      approvedSourceMessageIds: [...input.approvedSourceMessageIds].sort(),
      // Spread the kind-specific fields first, then set the canonical fields
      // explicitly so `id`/`required`/`kind` always win — previously the
      // spread ran AFTER, so a kind-specific field shadowing one of these
      // would silently override it (N4: fragile duplicate-key behavior).
      criteria: sortedCriteria.map((c) => ({
        ...(c as Record<string, unknown>),
        id: c.id,
        required: c.required,
        kind: c.kind,
      })),
    };
    const hash = createHash("sha256");
    hash.update(canonicalJson(payload));
    return `sha256:${hash.digest("hex")}`;
  }
}
