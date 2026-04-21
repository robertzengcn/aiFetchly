# Contract: resolve_system_dependency

**Type**: Advisory (no side effects) | **Direction**: Main process internal

---

## Input

```typescript
interface ResolveSystemDependencyInput {
  /** Raw stderr from the failed skill execution */
  readonly stderr: string;
  /** Skill manifest (contains system dependency declarations) */
  readonly manifest?: SkillManifest;
  /** Current platform: "darwin" | "linux" | "win32" */
  readonly platform: NodeJS.Platform;
}
```

## Output

```typescript
interface ResolveSystemDependencyOutput {
  /** Whether a dependency could be identified */
  readonly resolved: boolean;
  /** Normalized dependency ID matching catalog entry */
  readonly dependency_id?: string;
  /** The binary that was not found */
  readonly missing_binary?: string;
  /** Confidence score 0-1 */
  readonly confidence: number;
  /** Human-readable reason for the match */
  readonly reason: string;
  /** Per-platform install candidates from catalog */
  readonly platform_candidates?: Record<string, PlatformCandidate>;
  /** True if confidence is below auto-suggest threshold */
  readonly requires_manual_review: boolean;
}
```

## Behavior

1. Parse `stderr` through `SkillDiagnosticsService.diagnoseStderr()`
2. If `cause !== "missing_system_tool"`, return `{ resolved: false, confidence: 0, reason: "Not a system dependency error" }`
3. Cross-reference manifest `python.system[]` deps with catalog entries
4. Match missing binary from error to catalog entry by `probe` field
5. Return structured result with confidence:
   - Exact match from manifest + catalog: confidence = 0.95
   - Pattern match from stderr only: confidence = 0.7
   - No match: confidence = 0, resolved = false

## Error Cases

| Case | Output |
|------|--------|
| stderr is not a system tool error | `{ resolved: false, confidence: 0, reason: "..." }` |
| No manifest provided | confidence reduced, manual review flagged |
| dependency_id not in catalog | `{ resolved: false, confidence: 0, reason: "Unknown dependency" }` |

## Side Effects

None. This is a pure function.
