/**
 * PortableWorkspaceIdentityService — trusted owner of `.aifetchly/workspace.json`
 * validation and creation (design §11).
 *
 * Main-process only. Identity files are inspected from worker drafts (never
 * trusted raw) or read through the path-safe file store. Creation uses
 * randomUUID() and requires a main-process-resolved approved root plus an
 * explicit user-approved enable action.
 */

import { randomUUID } from "crypto";
import type {
  PortableWorkspaceIdentityDraft,
  PortableWorkspaceIdentityV1,
  PortableMemoryDiagnosticView,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import {
  PORTABLE_WORKSPACE_ID_PATTERN,
  PORTABLE_MEMORY_LIMITS,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import {
  PortableWorkspaceMemoryFileStore,
} from "@/service/PortableWorkspaceMemoryFileStore";

export interface PortableWorkspaceIdentityInspection {
  readonly state: "missing" | "valid" | "invalid";
  readonly identity?: PortableWorkspaceIdentityV1;
  readonly contentHash?: string;
  readonly diagnostic?: PortableMemoryDiagnosticView;
}

const IDENTITY_RELATIVE_PATH = ".aifetchly/workspace.json";
const MAX_IDENTITY_BYTES = 8 * 1024;

export class PortableWorkspaceIdentityService {
  /**
   * Validate a worker-produced identity draft. `raw` is untrusted JSON —
   * never cast; validate field by field (design §11.1).
   */
  inspectDraft(
    draft: PortableWorkspaceIdentityDraft | undefined
  ): PortableWorkspaceIdentityInspection {
    if (!draft) return { state: "missing" };
    if (draft.sizeBytes > MAX_IDENTITY_BYTES) {
      return invalid("workspace identity file exceeds size limit");
    }
    if (typeof draft.raw !== "object" || draft.raw === null) {
      return invalid("workspace identity must be a JSON object");
    }
    const raw = draft.raw as Record<string, unknown>;
    if (raw.schemaVersion !== 1) {
      return invalid(
        `unsupported workspace identity schemaVersion "${String(raw.schemaVersion)}"`
      );
    }
    if (
      typeof raw.workspaceId !== "string" ||
      !PORTABLE_WORKSPACE_ID_PATTERN.test(raw.workspaceId)
    ) {
      return invalid("workspaceId must be ws-<uuid>");
    }
    if (typeof raw.name !== "string" || raw.name.length < 1 || raw.name.length > 255) {
      return invalid("name must be a string of 1..255 characters");
    }
    const createdAt = raw.createdAt;
    if (
      typeof createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(createdAt) ||
      !Number.isFinite(new Date(createdAt).getTime())
    ) {
      return invalid("createdAt must be a valid UTC ISO 8601 timestamp");
    }
    return {
      state: "valid",
      identity: {
        schemaVersion: 1,
        workspaceId: raw.workspaceId,
        name: raw.name,
        createdAt,
      },
      contentHash: draft.contentHash,
    };
  }

  /**
   * Create (not yet write) a fresh identity. The caller confirms user
   * approval and supplies the trusted workspace root.
   */
  createIdentity(input: {
    readonly name: string;
    readonly now?: Date;
  }): PortableWorkspaceIdentityV1 {
    const name = input.name.trim().slice(0, 255);
    if (name.length < 1) throw new Error("workspace identity name is required");
    return {
      schemaVersion: 1,
      workspaceId: `ws-${randomUUID()}`,
      name,
      createdAt: (input.now ?? new Date()).toISOString(),
    };
  }

  /** Write the identity atomically (enable / regenerate flows). */
  async writeIdentity(
    store: PortableWorkspaceMemoryFileStore,
    identity: PortableWorkspaceIdentityV1
  ): Promise<void> {
    if (identity.workspaceId.length > PORTABLE_MEMORY_LIMITS.maxIdChars) {
      throw new Error("workspace id exceeds length limit");
    }
    await store.writeIdentity(identity);
  }

  /** Read + validate the identity file directly from disk (main-process). */
  async inspectOnDisk(
    store: PortableWorkspaceMemoryFileStore
  ): Promise<PortableWorkspaceIdentityInspection> {
    const file = await store.readIdentityFile();
    if (!file) return { state: "missing" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.raw);
    } catch {
      return invalid("workspace identity is not valid JSON");
    }
    return this.inspectDraft({
      relativePath: IDENTITY_RELATIVE_PATH,
      raw: parsed,
      contentHash: file.contentHash,
      sizeBytes: Buffer.byteLength(file.raw, "utf8"),
      mtimeMs: 0,
    });
  }

  /**
   * Regenerate: a fresh UUID for an intentional fork. Record ids are RETAINED
   * under scoped uniqueness (PRD §12.4 option 1 — recommended).
   */
  regenerateIdentity(input: {
    readonly name: string;
    readonly previous: PortableWorkspaceIdentityV1;
    readonly now?: Date;
  }): PortableWorkspaceIdentityV1 {
    return this.createIdentity({ name: input.name, now: input.now });
  }
}

function invalid(message: string): PortableWorkspaceIdentityInspection {
  return {
    state: "invalid",
    diagnostic: {
      code: "workspace-identity-invalid",
      relativePath: IDENTITY_RELATIVE_PATH,
      message,
      recoverable: false,
    },
  };
}
