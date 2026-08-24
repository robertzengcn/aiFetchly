/**
 * PromptSkillInvocationService — resolve, normalize, persist, and produce
 * the hidden context attachment for a `use_skill` invocation
 * (design §10.4-10.6).
 *
 * Contract highlights:
 *   - `skill` accepts a runtime id or an unambiguous visible name; ambiguity
 *     returns candidates and performs NO injection;
 *   - explicit (`/name`, user-driven) and automatic (model) selection enter
 *     the same resolver; `disable-model-invocation` blocks automatic
 *     selection only;
 *   - installation/update/repair/configure arguments are REJECTED — use_skill
 *     never mutates packages (FR-27);
 *   - the on-disk SKILL.md must still match the registered content hash;
 *   - same-hash repeated invocation is idempotent (`already-loaded`), and no
 *     second attachment is produced;
 *   - a changed hash (linked installs) fails with SKILL_CONTEXT_HASH_MISMATCH
 *     and emits a visible change notice instead of silently swapping
 *     instructions.
 */

import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import { PromptSkillContextAssembler } from "@/service/PromptSkillContextAssembler";
import {
  PromptSkillInvocationModule,
  type ActiveInvocationView,
} from "@/modules/PromptSkillInvocationModule";
import type {
  PromptSkillContextAttachment,
  PromptSkillResolutionContext,
  UsePromptSkillInput,
  UsePromptSkillResult,
} from "@/entityTypes/promptSkillTypes";

/** Default context budgets (tokens) — deliberately conservative. */
export const PROMPT_SKILL_DEFAULT_BUDGET = {
  availableTokens: 16_000,
  perSkillMaxTokens: 8_000,
} as const;

/** Words that mark a use_skill call as an install/lifecycle mutation. */
const INSTALL_MUTATION_RE =
  /\b(install|uninstall|update|upgrade|repair|un-?register|re-?register|configure|reinstall)\b/i;

export type InvocationOutcome =
  | {
      readonly ok: true;
      readonly result: UsePromptSkillResult;
      readonly attachment: PromptSkillContextAttachment | null;
    }
  | {
      readonly ok: false;
      readonly result: {
        readonly status: "error";
        readonly code: string;
        readonly message: string;
        readonly candidates?: readonly unknown[];
      };
      readonly attachment: null;
    };

export interface InvokePromptSkillOptions {
  readonly conversationId: string;
  readonly agentScope?: string;
  readonly workspaceId?: number;
  readonly conversationWorkspaceRoot: string;
  readonly invocationSource: "explicit" | "model" | "legacy-adapter";
  readonly availableTokens?: number;
  readonly perSkillMaxTokens?: number;
}

export class PromptSkillInvocationService {
  private readonly assembler = new PromptSkillContextAssembler();
  private readonly invocationModule = new PromptSkillInvocationModule();

  /**
   * Invoke a prompt skill. Never throws — all failures are structured
   * outcomes so the chat loop can surface them without a crash path.
   */
  async invoke(
    input: UsePromptSkillInput,
    options: InvokePromptSkillOptions
  ): Promise<InvocationOutcome> {
    const catalog = getDefaultPromptSkillCatalog();
    const resolutionContext: PromptSkillResolutionContext = {
      ...(options.workspaceId !== undefined
        ? { workspaceId: options.workspaceId }
        : {}),
    };

    // FR-27: use_skill resolves invocation only — never package mutation.
    if (
      INSTALL_MUTATION_RE.test(input.skill) ||
      (input.arguments !== undefined &&
        INSTALL_MUTATION_RE.test(input.arguments ?? ""))
    ) {
      return {
        ok: false,
        result: {
          status: "error",
          code: "SKILL_INSTALL_MUTATION_REJECTED",
          message:
            "use_skill invokes an installed prompt skill; it does not install, " +
            "update, repair, or configure skill packages. Use skill_install_prepare.",
        },
        attachment: null,
      };
    }

    const resolved = catalog.resolve(input.skill, resolutionContext);
    const definition = resolved.definition;
    if (!definition) {
      const candidates = resolved.ambiguousCandidates ?? [];
      return {
        ok: false,
        result: {
          status: "error",
          code: candidates.length > 1 ? "SKILL_AMBIGUOUS" : "SKILL_NOT_FOUND",
          message:
            candidates.length > 1
              ? `Multiple skills match '${input.skill}'. Invoke one by its runtime id.`
              : `No installed prompt skill matches '${input.skill}'.`,
          ...(candidates.length > 1 ? { candidates } : {}),
        },
        attachment: null,
      };
    }

    // disable-model-invocation blocks automatic selection only.
    if (
      options.invocationSource === "model" &&
      definition.manifest.disableModelInvocation === true
    ) {
      return {
        ok: false,
        result: {
          status: "error",
          code: "SKILL_DISABLED",
          message:
            `Skill '${definition.name}' disables automatic model invocation; ` +
            `the user must invoke it explicitly.`,
        },
        attachment: null,
      };
    }

    // Assemble + verify hash + token budget.
    const assembled = this.assembler.assemble({
      definition,
      conversationWorkspaceRoot: options.conversationWorkspaceRoot,
      availableTokens:
        options.availableTokens ?? PROMPT_SKILL_DEFAULT_BUDGET.availableTokens,
      perSkillMaxTokens:
        options.perSkillMaxTokens ??
        PROMPT_SKILL_DEFAULT_BUDGET.perSkillMaxTokens,
      ...(input.arguments !== undefined
        ? { invocationArguments: input.arguments }
        : {}),
    });
    if (!assembled.ok) {
      return { ok: false, result: assembled.error, attachment: null };
    }

    // Persist BEFORE the next model completion (design §10.10).
    let alreadyActive = false;
    let contextRevision = 1;
    try {
      const recorded = await this.invocationModule.recordInvocation({
        conversationId: options.conversationId,
        agentScope: options.agentScope ?? "",
        runtimeId: definition.runtimeId,
        contentHash: definition.contentHash,
        normalizedInstructions: assembled.context.normalizedInstructions,
        tokenEstimate: assembled.context.tokenEstimate,
        invocationArgumentsJson: JSON.stringify({
          ...(input.arguments !== undefined
            ? { arguments: input.arguments }
            : {}),
          ...(input.invocationReason !== undefined
            ? { invocationReason: input.invocationReason }
            : {}),
        }),
        invocationSource: options.invocationSource,
        invokedAt: new Date(),
      });
      alreadyActive = recorded.alreadyActive;
      contextRevision = recorded.entity.contextRevision;
    } catch (err) {
      // Persistence failure must not inject an unpersisted attachment —
      // compaction recovery depends on the durable record.
      return {
        ok: false,
        result: {
          status: "error",
          code: "SKILL_CONTEXT_INJECTION_FAILED",
          message: `Failed to persist invoked-skill state: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        attachment: null,
      };
    }

    const result: UsePromptSkillResult = {
      status: alreadyActive ? "already-loaded" : "loaded",
      runtimeId: definition.runtimeId,
      name: definition.name,
      contentHash: definition.contentHash,
      contextRevision,
    };

    // Same-hash repeat → short ack only; the context is already attached.
    const attachment: PromptSkillContextAttachment | null = alreadyActive
      ? null
      : {
          type: "invoked_prompt_skill",
          conversationId: options.conversationId,
          ...(options.agentScope !== undefined
            ? { agentId: options.agentScope }
            : {}),
          runtimeId: definition.runtimeId,
          name: definition.name,
          sourceLabel: scopeLabel(definition.scope),
          canonicalRoot: definition.canonicalRoot,
          contentHash: definition.contentHash,
          contextRevision,
          normalizedInstructions: assembled.context.normalizedInstructions,
          tokenEstimate: assembled.context.tokenEstimate,
          invokedAt: new Date().toISOString(),
        };

    return { ok: true, result, attachment };
  }

  /** Active invocations for compaction reattachment (deterministic order). */
  async listActiveInvocations(
    conversationId: string,
    agentScope = ""
  ): Promise<readonly ActiveInvocationView[]> {
    return this.invocationModule.listActive(conversationId, agentScope);
  }
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "workspace":
      return "workspace skill";
    case "plugin":
      return "plugin skill";
    case "built-in":
      return "built-in skill";
    default:
      return "user skill";
  }
}

let defaultService: PromptSkillInvocationService | null = null;

export function getDefaultPromptSkillInvocationService(): PromptSkillInvocationService {
  if (!defaultService) {
    defaultService = new PromptSkillInvocationService();
  }
  return defaultService;
}
