/**
 * Bootstrap portable workspace memory files for an approved workspace.
 *
 * Called when a watch is acquired (user selected / opened a workspace) so
 * `.aifetchly/workspace.json` and `.aifetchly/memory/` exist before the
 * first memory write. Does not install AGENTS.md/CLAUDE.md bridges and does
 * not re-enable a scope the user explicitly disabled.
 */

import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { PortableWorkspaceMemoryFileStore } from "@/service/PortableWorkspaceMemoryFileStore";
import { PortableWorkspaceIdentityService } from "@/service/PortableWorkspaceIdentityService";
import { PortableWorkspaceMemoryIndexService } from "@/service/PortableWorkspaceMemoryIndexService";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";
import type { WorkspaceMemoryScopeContext } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { log } from "@/modules/Logger";

export async function ensurePortableMemoryDefault(input: {
  readonly workspaceRoot: string;
  readonly displayName?: string;
  readonly workspaceKey?: string;
}): Promise<void> {
  const scope = await resolveScope(input);
  if (!scope.portableEnabled) return;
  await writeDefaultLayout(scope);
}

export async function writeDefaultLayout(
  scope: WorkspaceMemoryScopeContext
): Promise<void> {
  const store = new PortableWorkspaceMemoryFileStore(scope.workspaceRoot);
  const identityService = new PortableWorkspaceIdentityService();
  const indexService = new PortableWorkspaceMemoryIndexService();

  const identity = await identityService.inspectOnDisk(store);
  if (identity.state === "invalid") {
    log.warn(
      `[portable-memory] skip layout bootstrap: invalid identity at ${scope.workspaceRoot}`
    );
    return;
  }
  if (identity.state === "missing") {
    const fresh = identityService.createIdentity({
      name: scope.displayName || "workspace",
    });
    await identityService.writeIdentity(store, fresh);
  }

  await store.ensureMemoryDir();
  const readmeBlock = indexService.buildReadmeManagedBlock({
    sharingMode: "local",
  });
  const existingReadme = await store.readReadme();
  const nextReadme = indexService.applyManagedBlock(
    existingReadme,
    readmeBlock
  );
  if (nextReadme !== null) {
    await store.writeReadme(nextReadme);
  }
}

async function resolveScope(input: {
  readonly workspaceRoot: string;
  readonly displayName?: string;
  readonly workspaceKey?: string;
}): Promise<WorkspaceMemoryScopeContext> {
  const scopeModule = new WorkspaceMemoryScopeModule();
  let workspaceKey = input.workspaceKey;
  let displayName = input.displayName || "workspace";
  if (!workspaceKey) {
    const keyResolution = await new WorkspaceKeyService().resolve(
      input.workspaceRoot
    );
    workspaceKey = keyResolution.workspaceKey;
    if (!input.displayName) displayName = keyResolution.displayName;
  }
  return scopeModule.resolveLegacyScope({
    workspaceKey,
    workspaceRoot: input.workspaceRoot,
    displayName,
  });
}
