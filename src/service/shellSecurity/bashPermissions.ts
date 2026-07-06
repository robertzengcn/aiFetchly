/**
 * bashPermissions — orchestrator for the layered shell permission model.
 *
 * Flow mirrors Claude Code's design (trimmed to what this app needs):
 *
 *   1. Lex the command. Any unanalyzable construct (command substitution,
 *      backticks, process substitution, heredoc) is surfaced.
 *   2. Structural hazards → deny/ask BEFORE anything else.
 *   3. Tiered regex rules (deny > ask). Legacy denylist + new asklist.
 *   4. Semantic hazards per segment (eval/source/exec/shell -c).
 *   5. Per-segment path validation + redirect target validation.
 *   6. If nothing proved dangerous, `allow`.
 *
 * Strongest principle, matching Claude Code: when we cannot confidently map
 * shell text to runtime behavior, we return `ask` rather than `allow`.
 */

import { lex } from "./ShellLexer";
import { splitCompound } from "./compoundSplitter";
import {
  structuralHazards,
  semanticHazards,
  tieredRegexRules,
} from "./semanticHazards";
import { validateSegmentPaths } from "./pathValidation";
import { allow, type PermissionVerdict } from "./verdict";
import type { FilePathGuard } from "@/service/FilePathGuard";

/**
 * Check a shell command against the full layered permission model.
 *
 * Returns a verdict. Only `tier === "allow"` means the command may proceed.
 */
export function checkShellPermission(
  command: string,
  guard: FilePathGuard
): PermissionVerdict {
  // 1. Lex
  const lexResult = lex(command);

  // 2. Structural hazards from the lexer (unanalyzable constructs)
  const structural = structuralHazards(lexResult.unanalyzable, lexResult.hasHeredoc);
  if (structural) return structural;

  // 3. Tiered regex rules (deny > ask). These run before compound splitting
  //    so a deny pattern can't be defeated by splitting tricks.
  const tiered = tieredRegexRules(command);
  if (tiered) return tiered;

  // 4. Split into segments
  const segments = splitCompound(lexResult.tokens);

  // 5. Semantic hazards per segment
  const semantic = semanticHazards(segments);
  if (semantic) return semantic;

  // 6. Per-segment path validation + redirect validation
  const pathVerdict = validateSegmentPaths(segments, guard);
  if (pathVerdict) return pathVerdict;

  // 7. Nothing proved dangerous — allow.
  return allow();
}
