# Contract: install_system_dependency

**Type**: Side effect (validated) | **Direction**: IPC (renderer → main → result)

---

## IPC Channel

`SYSTEM_DEPENDENCY_INSTALL`

## Request (Renderer → Main)

```typescript
interface InstallSystemDependencyRequest {
  /** Dependency ID from resolver output */
  readonly dependency_id: string;
  /** Why the install is needed */
  readonly reason: string;
  /** Conversation context for audit */
  readonly conversation_id: string;
  /** Skill that triggered the need */
  readonly skill_name: string;
}
```

## Response (Main → Renderer)

```typescript
interface InstallSystemDependencyResponse {
  /** Whether the IPC call succeeded */
  readonly status: boolean;
  /** Human-readable message */
  readonly msg: string;
  /** Install result details */
  readonly data: InstallResultData | null;
}

interface InstallResultData {
  /** Typed install outcome */
  readonly install_status: InstallResultStatus;
  /** Dependency that was processed */
  readonly dependency_id: string;
  /** Binary that was probed after install */
  readonly probe?: string;
  /** Human-readable details */
  readonly details?: string;
  /** Whether the skill should be retried */
  readonly should_retry: boolean;
}
```

## InstallResultStatus Enum

```
"installed" | "already_installed" | "permission_denied" | 
"installer_not_found" | "unsupported_platform" | "path_issue" | "installation_failed"
```

## Execution Steps

1. **Validate dependency_id** against local catalog
   - Not found → `{ status: false, data: { install_status: "unsupported_platform" } }`
2. **Check platform support**
   - Current platform has no candidate → `{ install_status: "unsupported_platform" }`
3. **Pre-probe binary**
   - Already available → `{ install_status: "already_installed", should_retry: true }`
4. **Check package manager availability**
   - Manager not found → `{ install_status: "installer_not_found" }`
5. **Execute fixed command template**
   - Command uses package name from catalog only
   - Timeout: 5 minutes
6. **Handle result**
   - Parse exit codes per platform manager
   - Sanitize stderr (remove paths, secrets)
7. **Post-probe binary**
   - Found → `{ install_status: "installed", should_retry: true }`
   - Not found → `{ install_status: "path_issue", should_retry: false }`
8. **Refresh PATH + restart utility process** (on success)
9. **Audit log** the complete action

## Security Guarantees

- Command template is fixed: `brew install <catalog.package>` — no free-form input
- `dependency_id` must exist in local catalog — arbitrary strings are rejected
- Package name comes from catalog JSON, never from request parameters
- User confirmation is required before this IPC is called (enforced by UI)
- All actions are audit-logged
