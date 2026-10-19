// PluginFileArtifactService tests (TD-08 / HOST-17) — real temp filesystem so
// symlink/containment behavior is exercised for real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  PluginFileArtifactService,
  PLUGIN_ARTIFACT_LIMITS,
  validatePluginArtifactCsvText,
  extractCsvPreviewRecords,
  extractJsonPreviewRecords,
  type PluginArtifactCandidate,
} from "@/service/PluginFileArtifactService";

let root: string;
let service: PluginFileArtifactService;
let fixedNow: number;

const JSON_CANDIDATE: PluginArtifactCandidate = {
  version: 1,
  relativePath: "records.json",
  format: "json",
  recordCount: 2,
  complete: true,
};

const RECORDS = {
  schemaVersion: 1,
  records: [
    { businessName: "A", phone: "111" },
    { businessName: "B", phone: "222" },
  ],
};

beforeAll(() => {
  root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "yp-artifacts-")),
    "store"
  );
  fixedNow = Date.parse("2026-10-16T00:00:00Z");
  service = new PluginFileArtifactService({ root }, () => fixedNow);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function stageExecution(executionId: string): string {
  const staging = service.provisionStaging(executionId);
  fs.writeFileSync(path.join(staging, "records.json"), JSON.stringify(RECORDS));
  return staging;
}

describe("PluginFileArtifactService", () => {
  it("provisions staging, validates candidates, and promotes atomically", () => {
    stageExecution("exec-ok");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-ok",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(errors).toEqual([]);
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    expect(artifact.id).toMatch(/^pa_/);
    expect(artifact.recordCount).toBe(2);
    expect(artifact.conversationId).toBe("conv-1");
    // Promoted content + host metadata exist.
    const dir = path.join(root, "artifacts", artifact.id);
    expect(fs.existsSync(path.join(dir, "content.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "metadata.json"))).toBe(true);
  });

  it("promotion is idempotent per execution + candidate", () => {
    stageExecution("exec-idem");
    const first = service.promoteCandidates({
      executionId: "exec-idem",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    // B12: clean promotion releases staging. The plugin re-finalizes the
    // same execution's candidates (re-stage, e.g. a retry after a lost
    // response) and registration must return the EXISTING artifact.
    stageExecution("exec-idem");
    const second = service.promoteCandidates({
      executionId: "exec-idem",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(second.artifacts[0].id).toBe(first.artifacts[0].id);
    const ids = fs.readdirSync(path.join(root, "artifacts"));
    expect(ids.filter((id) => id === first.artifacts[0].id)).toHaveLength(1);
  });

  it("rejects a symlink candidate escaping staging", () => {
    const staging = stageExecution("exec-symlink");
    const outside = path.join(root, "..", "outside.json");
    fs.writeFileSync(outside, JSON.stringify(RECORDS));
    fs.symlinkSync(outside, path.join(staging, "records.csv"));
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-symlink",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [
        {
          version: 1,
          relativePath: "records.csv",
          format: "csv",
          recordCount: 0,
          complete: true,
        },
      ],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors[0]).toMatch(/regular file|escapes/);
    fs.unlinkSync(outside);
  });

  it("rejects a claimed record count that does not match the JSON content", () => {
    stageExecution("exec-mismatch");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-mismatch",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [{ ...JSON_CANDIDATE, recordCount: 99 }],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors[0]).toMatch(/record count mismatch/);
  });

  it("rejects disallowed candidate filenames", () => {
    stageExecution("exec-weird");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-weird",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [
        {
          version: 1,
          relativePath: "../evil.json",
          format: "json",
          recordCount: 0,
          complete: true,
        } as unknown as PluginArtifactCandidate,
      ],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors[0]).toMatch(/not allowed/);
  });

  it("drops a third candidate with an overflow notice (dead slice removed)", () => {
    const staging = stageExecution("exec-cap");
    fs.writeFileSync(
      staging + path.sep + "records.csv",
      "businessName,phone\n"
    );
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-cap",
      conversationId: "conv-cap",
      pluginName: "demo-plugin",
      candidates: [
        JSON_CANDIDATE,
        {
          version: 1,
          relativePath: "records.csv",
          format: "csv",
          recordCount: 0,
          complete: true,
        },
        JSON_CANDIDATE,
      ],
    });
    // Exactly the cap is promoted; the overflow candidate is never honored.
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].id).not.toBe(artifacts[1].id);
    expect(errors.some((e) => e.includes("too many candidates"))).toBe(true);
  });

  it("scopes list/preview/export/delete by conversation ownership", () => {
    stageExecution("exec-own");
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-own",
      conversationId: "conv-owner",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    const id = artifacts[0].id;

    // Owner sees it; another conversation does not.
    expect(service.listForConversation("conv-owner")).toHaveLength(1);
    expect(service.listForConversation("conv-other")).toHaveLength(0);

    const preview = service.preview("conv-owner", id);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      const rows = JSON.parse(preview.rows) as { records: unknown[] };
      expect(rows.records).toHaveLength(2);
    }
    expect(service.preview("conv-other", id).ok).toBe(false);

    const dest = path.join(root, "..", "export-test.json");
    expect(service.exportToPath("conv-owner", id, dest).ok).toBe(true);
    expect(service.exportToPath("conv-other", id, dest).ok).toBe(false);
    fs.unlinkSync(dest);

    expect(service.delete("conv-other", id).ok).toBe(false);
    expect(service.delete("conv-owner", id).ok).toBe(true);
    expect(service.listForConversation("conv-owner")).toHaveLength(0);
  });

  it("bounds the preview row count", () => {
    const staging = service.provisionStaging("exec-preview");
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify({
        schemaVersion: 1,
        records: Array.from({ length: 50 }, (_, i) => ({ i })),
      })
    );
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-preview",
      conversationId: "conv-p",
      pluginName: "demo-plugin",
      candidates: [{ ...JSON_CANDIDATE, recordCount: 50 }],
    });
    const preview = service.preview("conv-p", artifacts[0].id, 5);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      const rows = JSON.parse(preview.rows) as { records: unknown[] };
      expect(rows.records).toHaveLength(5);
    }
  });

  it("sweeps expired artifacts", () => {
    const staging = service.provisionStaging("exec-exp");
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify(RECORDS)
    );
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-exp",
      conversationId: "conv-exp",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(service.sweepExpired()).toBe(0); // not expired yet

    // A service with a later clock expires it. (Every artifact in this
    // suite shares the fixed clock, so the sweep may remove more than one —
    // the assertion is that this conversation's artifact is gone.)
    const later = new PluginFileArtifactService(
      { root },
      () => fixedNow + 31 * 24 * 60 * 60_000
    );
    expect(later.sweepExpired()).toBeGreaterThanOrEqual(1);
    expect(later.listForConversation("conv-exp")).toHaveLength(0);
  });

  it("releaseStaging removes the staging directory", () => {
    stageExecution("exec-clean");
    expect(fs.existsSync(service.stagingDir("exec-clean"))).toBe(true);
    service.releaseStaging("exec-clean");
    expect(fs.existsSync(service.stagingDir("exec-clean"))).toBe(false);
  });
});

describe("PluginFileArtifactService candidate hardening (B10)", () => {
  function promoteErr(
    executionId: string,
    candidate: PluginArtifactCandidate
  ): string {
    const { artifacts, errors } = service.promoteCandidates({
      executionId,
      conversationId: "conv-b10",
      pluginName: "demo-plugin",
      candidates: [candidate],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    return errors.join(" ");
  }

  function stagedText(
    executionId: string,
    name: "records.json" | "records.csv",
    text: string
  ): void {
    const staging = service.provisionStaging(executionId);
    fs.writeFileSync(path.join(staging, name), text);
  }

  it("rejects an in-staging relative symlink (validated before following the link)", () => {
    const executionId = "b10-link-inside";
    const staging = service.provisionStaging(executionId);
    const target = path.join(staging, "target.csv");
    fs.writeFileSync(target, JSON.stringify(RECORDS));
    fs.symlinkSync(target, path.join(staging, "records.csv"));
    const error = promoteErr(executionId, {
      version: 1,
      relativePath: "records.csv",
      format: "csv",
      recordCount: 2,
      complete: true,
    });
    expect(error).toMatch(/not a regular file/);
  });

  it("rejects a hard-linked candidate", () => {
    const executionId = "b10-hardlink";
    const staging = service.provisionStaging(executionId);
    const outside = path.join(root, "..", "b10-hardlink-source.json");
    fs.writeFileSync(outside, JSON.stringify(RECORDS));
    fs.linkSync(outside, path.join(staging, "records.json"));
    const error = promoteErr(executionId, JSON_CANDIDATE);
    expect(error).toMatch(/hard link/);
    fs.unlinkSync(outside);
  });

  it("binds filename and format (records.csv + format:json fails)", () => {
    const executionId = "b10-bind";
    stagedText(executionId, "records.csv", "businessName,phone\nA,111\n");
    const error = promoteErr(executionId, {
      version: 1,
      relativePath: "records.csv",
      format: "json",
      recordCount: 1,
      complete: true,
    });
    expect(error).toMatch(/filename\/format mismatch/);
  });

  it("rejects JSON without a records array / with a non-1 schemaVersion / with non-object records", () => {
    stagedText(
      "b10-no-records",
      "records.json",
      JSON.stringify({ schemaVersion: 1, summary: "no records here" })
    );
    const missing = promoteErr("b10-no-records", {
      ...JSON_CANDIDATE,
      recordCount: 0,
    });
    expect(missing).toMatch(/missing the records array/);

    stagedText(
      "b10-ver",
      "records.json",
      JSON.stringify({ schemaVersion: 2, records: [] })
    );
    const version = promoteErr("b10-ver", {
      ...JSON_CANDIDATE,
      recordCount: 0,
    });
    expect(version).toMatch(/schemaVersion/);

    stagedText(
      "b10-objs",
      "records.json",
      JSON.stringify({ schemaVersion: 1, records: [1, "str"] })
    );
    const shape = promoteErr("b10-objs", {
      ...JSON_CANDIDATE,
      recordCount: 2,
    });
    expect(shape).toMatch(/records must be objects/);
  });

  it("recounts CSV data records and rejects a bogus claim (one row claiming 999)", () => {
    const executionId = "b10-csv-count";
    stagedText(
      executionId,
      "records.csv",
      "businessName,phone\nA,111\n"
    );
    const error = promoteErr(executionId, {
      version: 1,
      relativePath: "records.csv",
      format: "csv",
      recordCount: 999,
      complete: true,
    });
    expect(error).toMatch(/record count mismatch.*claimed 999, found 1/);
  });

  it("rejects CSV formula-like leading cells whether quoted or not", () => {
    stagedText(
      "b10-risky-unquoted",
      "records.csv",
      'businessName,phone\n=CMD("calc"),123\n'
    );
    expect(
      promoteErr("b10-risky-unquoted", {
        version: 1,
        relativePath: "records.csv",
        format: "csv",
        recordCount: 1,
        complete: true,
      })
    ).toMatch(/spreadsheet-formula-like/);

    stagedText(
      "b10-risky-quoted",
      "records.csv",
      'businessName,phone\n"x",@abadcell\n'
    );
    expect(
      promoteErr("b10-risky-quoted", {
        version: 1,
        relativePath: "records.csv",
        format: "csv",
        recordCount: 1,
        complete: true,
      })
    ).toMatch(/spreadsheet-formula-like/);
  });

  it("accepts valid quoted CSV with escaped quotes and in-quote newlines", () => {
    const executionId = "b10-csv-valid";
    const staging = service.provisionStaging(executionId);
    fs.writeFileSync(
      path.join(staging, "records.csv"),
      'businessName,phone\n"A ""Q"" Co","555-1212"\n"B, Multi\nline","555-1213"\n'
    );
    const { artifacts, errors } = service.promoteCandidates({
      executionId,
      conversationId: "conv-b10",
      pluginName: "demo-plugin",
      candidates: [
        {
          version: 1,
          relativePath: "records.csv",
          format: "csv",
          recordCount: 2,
          complete: true,
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].recordCount).toBe(2);
    expect(artifacts[0].sizeBytes).toBeGreaterThan(0);
  });

  it("rejects unterminated quotes inside CSV", () => {
    stagedText(
      "b10-csv-unterm",
      "records.csv",
      'businessName,phone\n"A "open,123\n'
    );
    expect(
      promoteErr("b10-csv-unterm", {
        version: 1,
        relativePath: "records.csv",
        format: "csv",
        recordCount: 1,
        complete: true,
      })
    ).toMatch(/unexpected (?:quote|characters after a closing quote)|unterminated/);
  });

  it("records the host-computed sha256 digest on promoted artifacts", async () => {
    const executionId = "b10-digest";
    stagedText(executionId, "records.json", JSON.stringify(RECORDS));
    const { artifacts, errors } = service.promoteCandidates({
      executionId,
      conversationId: "conv-b10",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(errors).toEqual([]);
    expect(artifacts).toHaveLength(1);
    const { createHash } = await import("crypto");
    // B12: staging is released on clean promotion — digest the promoted
    // store copy (host-authoritative bytes) instead of the staging copy.
    const expected = createHash("sha256")
      .update(
        fs.readFileSync(
          path.join(root, "artifacts", artifacts[0].id, "content.json")
        )
      )
      .digest("hex");
    expect(artifacts[0].digest).toBe(expected);
    const meta = JSON.parse(
      fs.readFileSync(
        path.join(root, "artifacts", artifacts[0].id, "metadata.json"),
        "utf8"
      )
    ) as { digest?: string };
    expect(meta.digest).toBe(expected);
  });
});

describe("PluginFileArtifactService.readCandidates bounds (B10)", () => {
  it("ignores an oversized candidates.json manifest", () => {
    const executionId = "b10-manifest-big";
    const staging = service.provisionStaging(executionId);
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify(RECORDS)
    );
    fs.writeFileSync(
      path.join(staging, "candidates.json"),
      JSON.stringify({
        candidates: [JSON_CANDIDATE],
        padding: "x".repeat(PLUGIN_ARTIFACT_LIMITS.maxCandidatesManifestBytes + 16),
      })
    );
    expect(service.readCandidates(executionId)).toEqual([]);
  });

  it("ignores a symlinked candidates.json manifest", () => {
    const executionId = "b10-manifest-link";
    const staging = service.provisionStaging(executionId);
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify(RECORDS)
    );
    fs.writeFileSync(
      path.join(root, "..", "b10-manifest.json"),
      JSON.stringify({ candidates: [JSON_CANDIDATE] })
    );
    fs.symlinkSync(
      path.join(root, "..", "b10-manifest.json"),
      path.join(staging, "candidates.json")
    );
    expect(service.readCandidates(executionId)).toEqual([]);
    fs.unlinkSync(path.join(root, "..", "b10-manifest.json"));
  });
});

describe("validatePluginArtifactCsvText", () => {
  it("counts logical data records across CRLF/BOM/trailing newlines", () => {
    const text = "\uFEFFbusinessName,phone\r\nA,111\r\nB,222\r\n";
    const result = validatePluginArtifactCsvText(text);
    expect(result).toEqual({ ok: true, dataRecords: 2 });
    // Trailing newline must not create a phantom record.
    expect(validatePluginArtifactCsvText("a,b\n")).toEqual({
      ok: true,
      dataRecords: 0,
    });
  });

  it("rejects malformed quotes at end of input", () => {
    const result = validatePluginArtifactCsvText('a,b\n"unterminated');
    expect(result.ok).toBe(false);
  });
});

describe("PluginFileArtifactService.recoverStartupExecutions", () => {
  it("quarantines orphan (never promoted) staging and journals interrupted", () => {
    const orphanRoot = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "yp-startup-")),
      "store"
    );
    try {
      const orphanService = new PluginFileArtifactService(
        { root: orphanRoot },
        () => Date.parse("2026-10-16T00:00:00Z")
      );
      // Simulate a crashed execution: staging with candidates but no journal.
    const staging = orphanService.provisionStaging("exec-crashed");
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify(RECORDS)
    );

      const result = orphanService.recoverStartupExecutions();
      expect(result.interrupted).toEqual(["exec-crashed"]);

      // Journal says interrupted; a conversation poll re-polls and can find
      // the honest failure instead of waiting forever.
      const journal = JSON.parse(
        fs.readFileSync(path.join(orphanRoot, "journal", "exec-crashed.json"), "utf8")
      );
      expect(journal.artifacts).toEqual([]);
      expect(journal.errors[0]).toMatch(/interrupted: host restart/);

      // Staging moved into quarantine; staging/<id> is gone.
      expect(
        fs.existsSync(
          path.join(
            orphanRoot,
            "staging-quarantine",
            "exec-crashed",
            "records.json"
          )
        )
      ).toBe(true);
      expect(fs.existsSync(staging)).toBe(false);

      // Second sweep with the same id already quarantined: no duplicate.
      const again = orphanService.recoverStartupExecutions();
      expect(again.interrupted).toEqual([]);
    } finally {
      fs.rmSync(orphanRoot, { recursive: true, force: true });
    }
  });

  it("ages out stale retained staging after promotion but respects fresh ones (B12 auto-release lifecycle)", () => {
    const agedRoot = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "yp-startup-")),
      "store"
    );
    try {
      const agedService = new PluginFileArtifactService(
        { root: agedRoot },
        () => Date.parse("2026-01-01T00:00:00Z")
      );
      agedService.provisionStaging("exec-old");
      fs.writeFileSync(
        path.join(agedService.stagingDir("exec-old"), "records.json"),
        JSON.stringify(RECORDS)
      );
      const promoted = agedService.promoteCandidates({
        executionId: "exec-old",
        conversationId: "conv-old",
        pluginName: "demo-plugin",
        candidates: [JSON_CANDIDATE],
      });
      expect(promoted.errors).toEqual([]);
      // B12: clean promotion releases staging right away.
      expect(fs.existsSync(agedService.stagingDir("exec-old"))).toBe(false);

      // Crash-residue: a host death between the journal write and the
      // release can still leave retained staging; simulate that state for
      // BOTH executions — an aged one (journal at 01-01) and a fresh one.
      for (const id of ["exec-old", "exec-fresh"]) {
        fs.mkdirSync(agedService.stagingDir(id), { recursive: true });
        fs.writeFileSync(
          path.join(agedService.stagingDir(id), "records.json"),
          JSON.stringify(RECORDS)
        );
      }
      // Fresh execution: journaled 30 days after the aged one.
      const freshClock = new PluginFileArtifactService(
        { root: agedRoot },
        () => Date.parse("2026-01-31T00:00:00Z")
      );
      freshClock.promoteCandidates({
        executionId: "exec-fresh",
        conversationId: "conv-fresh",
        pluginName: "demo-plugin",
        candidates: [JSON_CANDIDATE],
      });
      // Re-fabricate the fresh residue (the promote re-released it).
      fs.mkdirSync(freshClock.stagingDir("exec-fresh"), { recursive: true });
      fs.writeFileSync(
        path.join(freshClock.stagingDir("exec-fresh"), "records.json"),
        JSON.stringify(RECORDS)
      );

      // A service 31 days after the AGED promotion performs the sweep: the
      // aged journal (01-01) pushes its residue past retention, the fresh
      // journal (01-31) does not.
      const later = new PluginFileArtifactService({ root: agedRoot }, () =>
        Date.parse("2026-02-02T00:00:00Z")
      );
      const result = later.recoverStartupExecutions();
      expect(result.agedPromotedStaging).toContain("exec-old");
      expect(result.agedPromotedStaging).not.toContain("exec-fresh");
      expect(fs.existsSync(agedService.stagingDir("exec-old"))).toBe(false);
      expect(fs.existsSync(agedService.stagingDir("exec-fresh"))).toBe(true);
    } finally {
      fs.rmSync(agedRoot, { recursive: true, force: true });
    }
  });
});

describe("PluginFileArtifactService bounded previews (B01)", () => {
  function promoteContent(
    executionId: string,
    content: string,
    format: "json" | "csv",
    recordCount: number
  ): string {
    const staging = service.provisionStaging(executionId);
    const name = format === "json" ? "records.json" : "records.csv";
    fs.writeFileSync(path.join(staging, name), content);
    const { artifacts, errors } = service.promoteCandidates({
      executionId,
      conversationId: "conv-b01",
      pluginName: "demo-plugin",
      candidates: [
        { version: 1, relativePath: name, format, recordCount, complete: true },
      ],
    });
    expect(errors).toEqual([]);
    expect(artifacts).toHaveLength(1);
    return artifacts[0].id;
  }

  it("keeps quoted newlines inside ONE CSV record (B01)", () => {
    const csv =
      "name,notes\n" +
      'Acme Caf\u00e9,"line one\nline two"\n' +
      'Beta Biz,"two,""cozy"" rooms"';
    const id = promoteContent("exec-b01-csv", csv, "csv", 2);
    const preview = service.preview("conv-b01", id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.format).toBe("csv");
    expect(preview.truncated).toBe(false);
    expect(JSON.parse(JSON.stringify(preview))).toHaveProperty("rows");
    // three logical records (header + 2), NOT five raw \n lines
    const segments = preview.rows.split("\n");
    expect(segments).toHaveLength(4); // header, Acme x2 lines, Beta record
    expect(segments[1]).toBe('Acme Caf\u00e9,"line one');
    expect(segments[2]).toBe('line two"');
    expect(segments[3]).toBe('Beta Biz,"two,""cozy"" rooms"');
  });

  it("bounds CSV preview to header + maxRows data records (B01)", () => {
    const csv =
      "name\n" +
      Array.from({ length: 10 }, (_, i) => `biz${i}`).join("\n");
    const id = promoteContent("exec-b01-csvrows", csv, "csv", 10);
    const preview = service.preview("conv-b01", id, 5);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.truncated).toBe(true);
    expect(preview.rows.split("\n")).toHaveLength(6);
    expect(preview.rows.startsWith("name\nbiz0\nbiz1")).toBe(true);
    expect(preview.rows).toContain("biz4");
    expect(preview.rows).not.toContain("biz5");
  });

  it("caps long fields and preserves only the allowlisted JSON envelope (B01)", () => {
    const longValue = "x".repeat(100_000);
    const doc = {
      schemaVersion: 1,
      flavorSummary: "arbitrary top-level field",
      records: [{ name: "Split Zone", longValue }],
    };
    const id = promoteContent(
      "exec-b01-jsonlong",
      JSON.stringify(doc),
      "json",
      1
    );
    const preview = service.preview("conv-b01", id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.truncated).toBe(true);
    const envelope = JSON.parse(preview.rows) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual([
      "records",
      "schemaVersion",
      "truncated",
    ]);
    const record = (envelope.records as Record<string, unknown>[])[0];
    expect(record.name).toBe("Split Zone");
    expect(typeof record.longValue).toBe("string");
    expect((record.longValue as string).length).toBeLessThanOrEqual(513);
    expect((record.longValue as string).endsWith("…")).toBe(true);
  });

  it("marks the preview truncated when the bounded input slice cut the file (B01)", () => {
    const big = `{"schemaVersion":1,"records":[${Array.from(
      { length: 5000 },
      (_, i) => `{"i":${i},"pad":"${"p".repeat(400)}"}`
    ).join(",")}]}`;
    expect(big.length).toBeGreaterThan(
      PLUGIN_ARTIFACT_LIMITS.maxPreviewReadBytes
    );
    const id = promoteContent("exec-b01-bigr", big, "json", 5000);
    const preview = service.preview("conv-b01", id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.truncated).toBe(true);
    const envelope = JSON.parse(preview.rows) as {
      records: unknown[];
      truncated: boolean;
    };
    expect(envelope.records.length).toBeLessThanOrEqual(5);
    expect(envelope.truncated).toBe(true);
    expect(Buffer.byteLength(preview.rows, "utf8")).toBeLessThan(
      PLUGIN_ARTIFACT_LIMITS.maxPreviewBytes
    );
  });

  it("falls back to a bounded text preview for legacy unparseable JSON (B01)", () => {
    const staging = service.provisionStaging("exec-b01-legacy");
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify({ schemaVersion: 1, records: [{ a: 1 }] })
    );
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-b01-legacy",
      conversationId: "conv-b01",
      pluginName: "demo-plugin",
      candidates: [{ ...JSON_CANDIDATE, recordCount: 1 }],
    });
    // Simulate a pre-B10 artifact on disk whose content predates validation.
    fs.writeFileSync(
      path.join(root, "artifacts", artifacts[0].id, "content.json"),
      "not json at all"
    );
    const preview = service.preview("conv-b01", artifacts[0].id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.rows).toBe("not json at all");
    expect(preview.truncated).toBe(false);
  });

  it("extractCsvPreviewRecords flags quote-cut and overflow (B01)", () => {
    const ok = extractCsvPreviewRecords('a,"b\nc"', 3);
    expect(ok.records).toHaveLength(1);
    expect(ok.hasMore).toBe(false);
    expect(ok.cutInsideQuotes).toBe(false);
    const overflow = extractCsvPreviewRecords("a\nb\nc\nd\ne\nf", 3);
    expect(overflow.records).toHaveLength(3);
    expect(overflow.hasMore).toBe(true);
    const quoteCut = extractCsvPreviewRecords('a,"b\nc', 3);
    expect(quoteCut.cutInsideQuotes).toBe(true);
  });

  it("extractJsonPreviewRecords salvages complete items from a cut doc (B01)", () => {
    const cut =
      '{"schemaVersion":1,"records":[{"a":1},{"a":2},{"broken":' + "true";
    const out = extractJsonPreviewRecords(cut, true, 5, 16 * 1024);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.truncated).toBe(true);
    expect(out.envelope.records).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
