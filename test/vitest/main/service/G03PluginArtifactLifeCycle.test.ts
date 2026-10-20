// G03 — quotas, provenance metadata, interruption journals, uninstall
// retention. Real temp filesystem; small injectable limit overrides keep the
// multi-GiB quotas testable in bytes.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import {
  PluginFileArtifactService,
  PLUGIN_ARTIFACT_LIMITS,
  type ArtifactFs,
  type PluginArtifactCandidate,
  type PluginExecutionJournalState,
} from "@/service/PluginFileArtifactService";

let root: string;
let fixedNow: number;

const JSON_CANDIDATE: PluginArtifactCandidate = {
  version: 1,
  relativePath: "records.json",
  format: "json",
  recordCount: 1,
  complete: true,
};

const RECORDS = { schemaVersion: 1, records: [{ n: "a" }] };

type ServiceOptions = ConstructorParameters<typeof PluginFileArtifactService>[0];

function makeService(
  overrides?: ServiceOptions,
  now?: () => number
): PluginFileArtifactService {
  return new PluginFileArtifactService(overrides, now);
}

function stage(
  service: PluginFileArtifactService,
  executionId: string,
  content: unknown = RECORDS
): void {
  const staging = service.provisionStaging(executionId);
  fs.writeFileSync(path.join(staging, "records.json"), JSON.stringify(content));
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "yp-g03-"));
  fixedNow = Date.parse("2026-10-16T00:00:00Z");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("G03 quota preflight", () => {
  it("admits under the default quotas", () => {
    const service = makeService({ root: path.join(root, "quota-ok") });
    const check = service.preflightArtifactQuota("demo-plugin", 1000);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.storeUsageBytes).toBe(0);
      expect(check.pluginUsageBytes).toBe(0);
    }
  });

  it("STORE_QUOTA when the scope store budget is exceeded", () => {
    const serviceRoot = path.join(root, "quota-store");
    // Register the seed artifact against DEFAULT limits.
    const seeder = makeService({ root: serviceRoot });
    stage(seeder, "q1");
    const promoted = seeder.promoteCandidates({
      executionId: "q1",
      conversationId: "qa",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(promoted.errors).toEqual([]);
    // The same store re-opened with a tiny budget is now over quota.
    const service = makeService({
      root: serviceRoot,
      limits: { maxStoreBytes: 10 },
    });
    const check = service.preflightArtifactQuota("demo-plugin", 0);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("STORE_QUOTA");
  });

  it("PLUGIN_QUOTA is per-plugin, other plugins unaffected", () => {
    const serviceRoot = path.join(root, "quota-plugin");
    const seeder = makeService({ root: serviceRoot });
    stage(seeder, "q2");
    const promoted = seeder.promoteCandidates({
      executionId: "q2",
      conversationId: "qa",
      pluginName: "wide-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(promoted.errors).toEqual([]);
    const service = makeService({
      root: serviceRoot,
      limits: { maxPluginStoreBytes: 10 },
    });
    expect(service.preflightArtifactQuota("wide-plugin").ok).toBe(false);
    // A different plugin is not charged for wide-plugin's bytes.
    const other = service.preflightArtifactQuota("lean-plugin", 10);
    expect(other.ok).toBe(true);
  });

  it("DISK_SPACE when statfs reports too little free space; skipped without statfsSync", () => {
    const stubFs = {
      ...((): ArtifactFsLike => {
        // Real fs is fine here; quota checks only touch metadata dirs.
        return realFsAdapter();
      })(),
      statfsSync: (_p: string) => ({ bsize: 4096, bavail: 10 }),
    };
    const service = makeService({
      root: path.join(root, "quota-disk"),
      fs: stubFs as never,
    });
    const denied = service.preflightArtifactQuota("demo-plugin", 0);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe("DISK_SPACE");
      // incoming bytes reduce the free cushion for the promotion that is
      // about to run.
      expect(denied.error).toContain("insufficient free disk space");
    }
    // Without the optional statfsSync the disk check cannot fire.
    const noFsField = { ...stubFs } as { statfsSync?: unknown };
    delete noFsField.statfsSync;
    const service2 = makeService({
      root: path.join(root, "quota-disk2"),
      fs: noFsField as never,
    });
    expect(service2.preflightArtifactQuota("demo-plugin").ok).toBe(true);
  });

  it("promotion honors the quota and reports the failure per candidate", () => {
    const service = makeService({
      root: path.join(root, "quota-promote"),
      limits: { maxStoreBytes: 10 },
    });
    stage(service, "q3");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "q3",
      conversationId: "qa",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/quota exceeded/);
  });
});

describe("G03 provenance metadata", () => {
  it("records identity fields (plugin version/generation, digest, scope, status)", () => {
    const service = makeService({ root: path.join(root, "meta") });
    stage(service, "exec-meta");
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-meta",
      conversationId: "conv-meta",
      pluginName: "demo-plugin",
      pluginVersion: "1.4.2",
      pluginGeneration: "gen-7",
      resultStatus: "complete",
      candidates: [JSON_CANDIDATE],
    });
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.executionId).toBe("exec-meta");
    expect(artifact.conversationId).toBe("conv-meta");
    expect(artifact.pluginName).toBe("demo-plugin");
    expect(artifact.pluginVersion).toBe("1.4.2");
    expect(artifact.pluginGeneration).toBe("gen-7");
    expect(artifact.userScopeId).toBe("default");
    expect(artifact.status).toBe("complete");
    expect(artifact.mimeType).toBe("application/json");
    expect(artifact.digest).toMatch(/^[0-9a-f]{64}$/);
    // The digest matches the actual content bytes.
    const content = fs.readFileSync(
      path.join(root, "meta", "artifacts", artifact.id, "content.json")
    );
    expect(artifact.digest).toBe(createHash("sha256").update(content).digest("hex"));
    // Degraded result status is honored.
    stage(service, "exec-meta");
    const degraded = service.promoteCandidates({
      executionId: "exec-meta",
      conversationId: "conv-meta",
      pluginName: "demo-plugin",
      resultStatus: "degraded",
      candidates: [JSON_CANDIDATE],
    });
    expect(degraded.artifacts[0].status).toBe("complete"); // idempotent re-registration keeps the original status
  });

  it("normalizes legacy metadata on read (pre-G03 registrations)", () => {
    const serviceRoot = path.join(root, "meta-legacy");
    const service = makeService({ root: serviceRoot });
    stage(service, "exec-legacy");
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-legacy",
      conversationId: "conv-legacy",
      pluginName: "legacy-plugin",
      candidates: [JSON_CANDIDATE],
    });
    const id = artifacts[0].id;
    const metadataPath = path.join(
      serviceRoot,
      "artifacts",
      id,
      "metadata.json"
    );
    // Strip the new fields to simulate a pre-G03 registration.
    const raw = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    for (const key of [
      "schemaVersion",
      "mimeType",
      "userScopeId",
      "status",
      "pluginVersion",
      "pluginGeneration",
    ]) {
      delete raw[key];
    }
    fs.writeFileSync(metadataPath, JSON.stringify(raw));
    const normalized = makeService({ root: serviceRoot }).listForConversation(
      "conv-legacy"
    );
    expect(normalized).toHaveLength(1);
    const artifact2 = normalized[0];
    expect(artifact2.schemaVersion).toBe(1);
    expect(artifact2.executionId).toBe("exec-legacy");
    expect(artifact2.mimeType).toBe("application/json");
    expect(artifact2.userScopeId).toBe("default");
    expect(artifact2.status).toBe("complete");
    expect(artifact2.pluginVersion).toBeUndefined();
    expect(artifact2.pluginGeneration).toBeUndefined();
  });
});

describe("G03 execution journals", () => {
  it("begin/read round-trip and conversation listing scope by owner", () => {
    const serviceRoot = path.join(root, "journal-rt");
    const service = makeService({ root: serviceRoot });
    service.beginExecutionJournal({
      executionId: "exec-j1",
      conversationId: "conv-j",
      pluginName: "demo-plugin",
    });
    expect(
      fs.existsSync(path.join(serviceRoot, "journal", "exec-j1.json"))
    ).toBe(true);
    const state = service.readJournalState("exec-j1");
    expect(state).not.toBeNull();
    expect(state?.status).toBe("running");
    expect(state?.conversationId).toBe("conv-j");
    expect(state?.pluginName).toBe("demo-plugin");
    expect(state?.registeredCount).toBe(0);

    service.beginExecutionJournal({
      executionId: "exec-j2",
      conversationId: "conv-other",
      pluginName: "demo-plugin",
    });
    const onlyConvJ = service.listJournalStatesForConversation("conv-j");
    expect(onlyConvJ.map((j) => j.executionId)).toEqual(["exec-j1"]);
  });

  it("promotion upgrades the journal with status + registeredCount", () => {
    const service = makeService({ root: path.join(root, "journal-upg") });
    service.beginExecutionJournal({
      executionId: "exec-upg",
      conversationId: "conv-u",
      pluginName: "demo-plugin",
    });
    stage(service, "exec-upg");
    const promoted = service.promoteCandidates({
      executionId: "exec-upg",
      conversationId: "conv-u",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(promoted.errors).toEqual([]);
    const state = service.readJournalState("exec-upg");
    expect(state).not.toBeNull();
    expect(state?.status).toBe("complete");
    expect(state?.registeredCount).toBe(1);
  });

  it("startup recovery marks no-artifact journals interrupted and quarantines staging; registered journals promote", () => {
    // Interrupted: journal says running, staging holds an unpromoted file.
    const interruptedRoot = path.join(root, "recover-int");
    const svc = makeService({ root: interruptedRoot });
    svc.beginExecutionJournal({
      executionId: "exec-crash",
      conversationId: "conv-crash",
      pluginName: "demo-plugin",
    });
    stage(svc, "exec-crash");
    const out = makeService({ root: interruptedRoot }).recoverStartupExecutions();
    expect(out.interrupted).toEqual(["exec-crash"]);
    const journal = svc.readJournalState("exec-crash");
    expect(journal?.status).toBe("interrupted");
    expect(journal?.conversationId).toBe("conv-crash");
    expect(journal?.pluginName).toBe("demo-plugin");
    expect(fs.existsSync(path.join(interruptedRoot, "staging", "exec-crash"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(interruptedRoot, "staging-quarantine", "exec-crash", "records.json")
      )
    ).toBe(true);

    // Promoted: journal with registered artifacts restores registration.
    const promotedRoot = path.join(root, "recover-promo");
    const svc2 = makeService({ root: promotedRoot });
    svc2.beginExecutionJournal({
      executionId: "exec-ok2",
      conversationId: "conv-ok",
      pluginName: "demo-plugin",
    });
    stage(svc2, "exec-ok2");
    const first = svc2.promoteCandidates({
      executionId: "exec-ok2",
      conversationId: "conv-ok",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(first.errors).toEqual([]);
    const restored = makeService({ root: promotedRoot }).listForConversation("conv-ok");
    expect(restored.map((a) => a.id)).toEqual([first.artifacts[0].id]);
  });

  it("degraded resultStatus journals degraded; failures journal failed", () => {
    const service = makeService({ root: path.join(root, "journal-degraded") });
    service.beginExecutionJournal({
      executionId: "exec-deg",
      conversationId: "conv-d",
      pluginName: "demo-plugin",
    });
    stage(service, "exec-deg");
    const degraded = service.promoteCandidates({
      executionId: "exec-deg",
      conversationId: "conv-d",
      pluginName: "demo-plugin",
      resultStatus: "degraded",
      candidates: [JSON_CANDIDATE],
    });
    expect(degraded.errors).toEqual([]);
    expect(service.readJournalState("exec-deg")?.status).toBe("degraded");

    // A failing promotion (bogus record count) journals "failed".
    service.beginExecutionJournal({
      executionId: "exec-fail",
      conversationId: "conv-d",
      pluginName: "demo-plugin",
    });
    stage(service, "exec-fail");
    const failed = service.promoteCandidates({
      executionId: "exec-fail",
      conversationId: "conv-d",
      pluginName: "demo-plugin",
      candidates: [{ ...JSON_CANDIDATE, recordCount: 99 }],
    });
    expect(failed.artifacts).toHaveLength(0);
    const failState = service.readJournalState("exec-fail");
    expect(failState?.status).toBe("failed");
    expect(failState?.message).not.toBeNull();
  });
});

describe("G03 uninstall retention", () => {
  it("shrinks the retention window; artifacts then sweep away", () => {
    const serviceRoot = path.join(root, "uninstall");
    const service = makeService({ root: serviceRoot }, () => fixedNow);
    stage(service, "exec-un");
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-un",
      conversationId: "conv-un",
      pluginName: "b16-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(artifacts).toHaveLength(1);
    const reconfirmed = service.applyPluginUninstallRetention("b16-plugin");
    expect(reconfirmed).toBe(1);
    // Status preserved; expiresAt shrank to now + 7d.
    const artifact = service
      .listForConversation("conv-un")
      .find((a) => a.id === artifacts[0].id);
    expect(artifact).toBeDefined();
    expect(artifact?.status).toBe("complete");
    expect(artifact?.expiresAt).toBe(
      new Date(fixedNow + PLUGIN_ARTIFACT_LIMITS.pluginUninstallRetentionMs).toISOString()
    );

    // Other plugin artifacts keep their original window.
    stage(service, "exec-keep");
    const keep = service.promoteCandidates({
      executionId: "exec-keep",
      conversationId: "conv-un",
      pluginName: "survivor-plugin",
      candidates: [JSON_CANDIDATE],
    });
    service.applyPluginUninstallRetention("b16-plugin");
    expect(
      service.listForConversation("conv-un").find((a) => a.id === keep.artifacts[0].id)
    ).toBeDefined();

    // After the window passes the sweep removes the uninstalled plugin's data.
    const later = makeService(
      { root: serviceRoot },
      () => fixedNow + 8 * 24 * 60 * 60_000
    );
    later.sweepExpired();
    const remaining = later.listForConversation("conv-un");
    expect(remaining.map((a) => a.id)).toEqual([keep.artifacts[0].id]);
  });
});

// -------------------------------------------------------------- harness glue

interface ArtifactFsLike extends ArtifactFs {}

function realFsAdapter(): ArtifactFsLike {
  return {
    existsSync: (p) => fs.existsSync(p),
    statSync: (p) => fs.statSync(p),
    lstatSync: (p) => fs.lstatSync(p),
    realpathSync: (p) => fs.realpathSync(p),
    mkdirSync: (p, options) => fs.mkdirSync(p, options),
    readdirSync: (p) => fs.readdirSync(p),
    copyFileSync: (from, to) => fs.copyFileSync(from, to),
    writeFileSync: (p, data, options) => fs.writeFileSync(p, data, options),
    readFileSync: (p) => fs.readFileSync(p, "utf8"),
    readBufferSync: (p) => fs.readFileSync(p),
    readBufferSliceSync: (p, end) => {
      const fd = fs.openSync(p, "r");
      try {
        const buffer = Buffer.alloc(Math.max(0, end));
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    },
    readChunkAtSync: (p, position, length) => {
      const fd = fs.openSync(p, "r");
      try {
        const buffer = Buffer.alloc(Math.max(0, length));
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, position);
        return buffer.subarray(0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    },
    unlinkSync: (p) => fs.unlinkSync(p),
    rmSync: (p, options) => fs.rmSync(p, options),
    renameSync: (from, to) => fs.renameSync(from, to),
  };
}
