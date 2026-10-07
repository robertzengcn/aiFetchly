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
  /**
   * T17 (FR-19): when the caller supplies the actual approved message
   * contents (messageId → text), criterion offsets are validated against the
   * real content length — an endOffset past the end of the source message is
   * an unanchored criterion and freeze throws. Optional: callers that only
   * have IDs (or synthetic sources) omit it and only the membership/direction
   * checks apply.
   */
  readonly approvedSourceContents?: Readonly<Record<string, string>>;
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
      // T17 (FR-03/19): a required criterion with no sourceRefs has no anchor
      // into the approved user message — anything could satisfy it. Reject.
      if (criterion.required && criterion.sourceRefs.length === 0) {
        throw new Error(
          `required criterion ${criterion.id} has empty sourceRefs`
        );
      }
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
        // T17 (FR-19): validate offsets against the actual approved message
        // content when the caller supplied it — an endOffset past the end of
        // the real message is an unanchored criterion.
        const content = input.approvedSourceContents?.[ref.messageId];
        if (content !== undefined && ref.endOffset > content.length) {
          throw new Error(
            `criterion ${criterion.id} offset ${ref.endOffset} is beyond the approved content length ${content.length} for message ${ref.messageId}`
          );
        }
      }
    }

    // T17 (FR-01/19): duplicate criterion IDs let one passed criterion ID
    // satisfy distinct required criteria even when another criterion with the
    // same ID fails. Reject at freeze time.
    const seenIds = new Set<string>();
    for (const criterion of input.criteria) {
      if (seenIds.has(criterion.id)) {
        throw new Error(`duplicate criterion id ${criterion.id}`);
      }
      seenIds.add(criterion.id);
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
    const preHashContract: TaskCompletionContract = {
      schemaVersion: 1,
      contractId,
      // Placeholder — replaced below after normalization (T17).
      contractHash: "sha256:pending",
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
    //
    // T17: normalize via the schema BEFORE hashing, and return exactly the
    // normalized representation. Zod strips unknown fields on parse, so a
    // contract carrying an extra criterion property would leave freeze with
    // the field attached but lose it on reload (storage re-parses) — after
    // which verifyHash returns false for an untampered contract. The hash is
    // computed over the NORMALIZED criteria (post-strip), so the frozen,
    // persisted, and reloaded forms are identical and the hash stable for
    // clean inputs too.
    const normalized: TaskCompletionContract = taskCompletionContractSchema.parse(preHashContract);
    const contractHash = this.computeHash({
      objective: normalized.objective,
      sourceUserMessageId: normalized.sourceUserMessageId,
      approvedSourceMessageIds: normalized.approvedSourceMessageIds,
      mode: normalized.mode,
      criteria: normalized.criteria,
    });
    return { ...normalized, contractHash };
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
