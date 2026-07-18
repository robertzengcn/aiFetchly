import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginInstallService } from "@/service/PluginInstallService";
import { PluginSourceRegistry } from "@/service/pluginSources/PluginSourceRegistry";
import type {
  PluginAcquireResult,
  PluginSourceFetcher,
  PluginSourceRequest,
} from "@/service/pluginSources/pluginSourceTypes";
import type {
  PluginImportResult,
  PluginImportSuccess,
} from "@/service/PluginImportService";
import type { PluginSourceProvenance } from "@/entityTypes/pluginTypes";

function makeStubbedRegistry(
  kind: PluginSourceFetcher["kind"],
  acquireImpl: (req: PluginSourceRequest) => Promise<PluginAcquireResult>
): PluginSourceRegistry {
  const reg = new PluginSourceRegistry();
  reg.register({ kind, acquire: acquireImpl });
  return reg;
}

/**
 * Drives the REAL PluginInstallService.installFromSource provenance-merge
 * code path by injecting a stub fetcher (returns a temp localRoot) and a
 * capturing installFromLocalRoot. Returns the provenance object that
 * production code computed, so assertions exercise the actual merge
 * expression — not a replica. If the production merge drifts, these
 * tests fail.
 */
async function captureProvenance(
  req: PluginSourceRequest
): Promise<PluginSourceProvenance> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-"));
  fs.writeFileSync(path.join(tmp, "marker"), "x");

  const reg = makeStubbedRegistry(req.kind, async () => ({
    success: true,
    source: {
      localRoot: tmp,
      cleanup: async () => {
        /* noop */
      },
    },
  }));

  let captured: PluginSourceProvenance | undefined;
  const fakeInstall = async (
    _localRoot: string,
    opts: { overwrite?: boolean; provenance?: PluginSourceProvenance }
  ): Promise<PluginImportResult> => {
    captured = opts.provenance;
    const ok: PluginImportSuccess = {
      success: true,
      plugin: {
        id: 1,
        name: "stub-plugin",
        version: "1.0.0",
        source: "local",
        enabled: true,
        health: "healthy",
        skillCount: 0,
        mcpServerCount: 0,
        agentCount: 0,
        permissions: [],
        lastUpdated: new Date().toISOString(),
      },
    };
    return ok;
  };

  try {
    const svc = new PluginInstallService(reg, fakeInstall);
    const r = await svc.installFromSource(req);
    if (!r.success) {
      throw new Error(
        `installFromSource unexpectedly failed: ${JSON.stringify(r.errors)}`
      );
    }
    if (!captured) {
      throw new Error("provenance was not forwarded to installFromLocalRoot");
    }
    return captured;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("install pipeline provenance merge", () => {
  it("threads marketplace source + sourceMeta", async () => {
    const p = await captureProvenance({
      kind: "github",
      uri: "owner/repo",
      source: "marketplace",
      sourceMeta: {
        marketplace: { marketplaceName: "team", entryName: "x" },
      },
    });
    expect(p.source).toBe("marketplace");
    expect(p.sourceMeta).toHaveProperty("marketplace");
  });

  it("preserves npm registry alongside sourceMeta", async () => {
    const p = await captureProvenance({
      kind: "npm",
      npmPackage: "pkg",
      npmRegistry: "https://registry.example.com",
      sourceMeta: { marketplace: { marketplaceName: "team" } },
    });
    expect(p.sourceMeta).toMatchObject({
      registry: "https://registry.example.com",
      marketplace: { marketplaceName: "team" },
    });
  });

  it("defaults source to undefined when caller omits it (backward compatible)", async () => {
    const p = await captureProvenance({ kind: "local-folder" });
    expect(p.source).toBeUndefined();
    expect(p.sourceMeta).toEqual({});
  });
});
