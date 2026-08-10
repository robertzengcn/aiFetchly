import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import { constants as fsConstants } from "fs";
import type { PermissionPreview } from "@/entityTypes/aiImageAttachmentToolTypes";
import type {
  SkillDefinition,
  SkillExecutionContext,
} from "@/entityTypes/skillTypes";
import { USEREMAIL } from "@/config/usersetting";
import { Token } from "@/modules/token";
import { FilePathGuard } from "@/service/FilePathGuard";
import {
  getGeneratedImageUserRoot,
  resolveGeneratedImageProtocolPath,
} from "@/service/AIChatGeneratedImageProtocol";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";

const MAX_EXPORT_ITEMS = 50;
const DEFAULT_EXPORT_DIRECTORY = "generated-artifacts";

type CollisionPolicy = "rename" | "fail" | "overwrite";

interface ExportRequestItem {
  artifactUrl: string;
  destination?: string;
}

interface ParsedExportArgs {
  artifacts: ExportRequestItem[];
  collisionPolicy: CollisionPolicy;
}

export interface ExportedArtifactItem {
  artifactUrl: string;
  requestedDestination?: string;
  destination?: string;
  status: "exported" | "failed" | "cancelled";
  renamed: boolean;
  error?: string;
}

export interface ExportGeneratedArtifactsResult {
  status: "completed" | "partial" | "failed" | "cancelled";
  requestedCount: number;
  exportedCount: number;
  failedCount: number;
  cancelledCount: number;
  collisionPolicy: CollisionPolicy;
  items: ExportedArtifactItem[];
}

export interface ExportGeneratedArtifactsDeps {
  resolveWorkspace: (
    conversationId: string
  ) => Promise<{ rootPath: string } | null>;
  getUserDataPath: () => string;
  getCurrentUserEmail: () => string;
  lstat: typeof fs.lstat;
  mkdir: typeof fs.mkdir;
  copyFile: typeof fs.copyFile;
  access: typeof fs.access;
  realpath: typeof fs.realpath;
}

function defaultDeps(): ExportGeneratedArtifactsDeps {
  const resolver = new WorkspaceResolver();
  return {
    resolveWorkspace: (conversationId) => resolver.resolve(conversationId),
    getUserDataPath: () => app.getPath("userData"),
    getCurrentUserEmail: () => new Token().getValue(USEREMAIL),
    lstat: fs.lstat,
    mkdir: fs.mkdir,
    copyFile: fs.copyFile,
    access: fs.access,
    realpath: fs.realpath,
  };
}

function parseArgs(
  args: Record<string, unknown>
): { ok: true; value: ParsedExportArgs } | { ok: false; error: string } {
  if (!Array.isArray(args.artifacts)) {
    return { ok: false, error: "`artifacts` must be an array." };
  }
  if (args.artifacts.length === 0 || args.artifacts.length > MAX_EXPORT_ITEMS) {
    return {
      ok: false,
      error: `Provide between 1 and ${MAX_EXPORT_ITEMS} artifacts.`,
    };
  }
  const artifacts: ExportRequestItem[] = [];
  const seen = new Set<string>();
  for (const raw of args.artifacts) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Every artifact must be an object." };
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.artifactUrl !== "string" || item.artifactUrl.length === 0) {
      return { ok: false, error: "Every artifact requires `artifactUrl`." };
    }
    if (
      item.destination !== undefined &&
      (typeof item.destination !== "string" || item.destination.length === 0)
    ) {
      return {
        ok: false,
        error: "`destination` must be a non-empty relative path.",
      };
    }
    const destination = item.destination as string | undefined;
    const key = `${item.artifactUrl}\u0000${destination ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    artifacts.push({ artifactUrl: item.artifactUrl, destination });
  }
  const rawPolicy = args.collisionPolicy ?? "rename";
  if (
    rawPolicy !== "rename" &&
    rawPolicy !== "fail" &&
    rawPolicy !== "overwrite"
  ) {
    return {
      ok: false,
      error: "`collisionPolicy` must be rename, fail, or overwrite.",
    };
  }
  return { ok: true, value: { artifacts, collisionPolicy: rawPolicy } };
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function exists(
  filePath: string,
  access: ExportGeneratedArtifactsDeps["access"]
): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function selectDestination(input: {
  requested: string;
  policy: CollisionPolicy;
  guard: FilePathGuard;
  mkdir: ExportGeneratedArtifactsDeps["mkdir"];
  access: ExportGeneratedArtifactsDeps["access"];
  realpath: ExportGeneratedArtifactsDeps["realpath"];
}): Promise<{ path: string; renamed: boolean }> {
  if (path.isAbsolute(input.requested)) {
    throw new Error("Artifact destinations must be relative to the workspace.");
  }
  const initial = input.guard.validate(input.requested);
  if (!initial.safe) {
    throw new Error(initial.error ?? "Destination is outside the workspace.");
  }
  const workspaceRoot = input.guard.getRoots()[0];
  let existingAncestor = path.dirname(initial.resolvedPath);
  while (
    existingAncestor !== workspaceRoot &&
    !(await exists(existingAncestor, input.access))
  ) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const realAncestor = await input.realpath(existingAncestor);
  if (!isContained(workspaceRoot, realAncestor)) {
    throw new Error(
      "Destination parent resolves outside the approved workspace."
    );
  }
  await input.mkdir(path.dirname(initial.resolvedPath), { recursive: true });
  const afterMkdir = input.guard.validate(initial.resolvedPath);
  if (!afterMkdir.safe) {
    throw new Error(
      afterMkdir.error ?? "Destination is outside the workspace."
    );
  }
  const destination = afterMkdir.resolvedPath;
  if (!(await exists(destination, input.access))) {
    return { path: destination, renamed: false };
  }
  if (input.policy === "overwrite") {
    return { path: destination, renamed: false };
  }
  if (input.policy === "fail") {
    throw new Error(`Destination already exists: ${input.requested}`);
  }
  const extension = path.extname(destination);
  const stem = destination.slice(0, destination.length - extension.length);
  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!(await exists(candidate, input.access))) {
      return { path: candidate, renamed: true };
    }
  }
  throw new Error("Could not find an available destination filename.");
}

function buildPermissionPreview(
  args: Record<string, unknown>
): PermissionPreview | undefined {
  if (!Array.isArray(args.artifacts)) return undefined;
  const items = args.artifacts
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object"
    )
    .map((item) => {
      const source =
        typeof item.artifactUrl === "string" ? item.artifactUrl : "artifact";
      const destination =
        typeof item.destination === "string"
          ? item.destination
          : DEFAULT_EXPORT_DIRECTORY;
      return `${source} → ${destination}`;
    })
    .slice(0, MAX_EXPORT_ITEMS);
  if (items.length === 0) return undefined;
  return {
    kind: "file_transfer",
    titleKey: "aiChatV2.artifactExport.permissionTitle",
    descriptionKey: "aiChatV2.artifactExport.permissionDescription",
    items,
    destinationLabel: "the approved workspace",
  };
}

export class ExportGeneratedArtifactsService {
  constructor(
    private readonly deps: ExportGeneratedArtifactsDeps = defaultDeps()
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<{
    success: boolean;
    result: ExportGeneratedArtifactsResult | { error: string };
  }> {
    const parsed = parseArgs(args);
    if (!parsed.ok) return { success: false, result: { error: parsed.error } };
    const workspace = await this.deps.resolveWorkspace(context.conversationId);
    if (!workspace) {
      return {
        success: false,
        result: {
          error: "An approved workspace is required to export artifacts.",
        },
      };
    }
    const userDataPath = this.deps.getUserDataPath();
    const userRoot = path.resolve(
      getGeneratedImageUserRoot(userDataPath, this.deps.getCurrentUserEmail())
    );
    const guard = new FilePathGuard([workspace.rootPath]);
    const items: ExportedArtifactItem[] = [];

    for (const artifact of parsed.value.artifacts) {
      if (context.signal?.aborted) {
        items.push({
          artifactUrl: artifact.artifactUrl,
          requestedDestination: artifact.destination,
          status: "cancelled",
          renamed: false,
          error: "Artifact export was cancelled.",
        });
        continue;
      }
      try {
        const source = resolveGeneratedImageProtocolPath(
          artifact.artifactUrl,
          userDataPath
        );
        if (!source || !isContained(userRoot, source)) {
          throw new Error(
            "Artifact URL is not owned by the current AiFetchly user."
          );
        }
        const sourceStats = await this.deps.lstat(source);
        if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
          throw new Error(
            "Artifact source must be a regular app-managed file."
          );
        }
        const requested =
          artifact.destination ??
          path.join(DEFAULT_EXPORT_DIRECTORY, path.basename(source));
        const destination = await selectDestination({
          requested,
          policy: parsed.value.collisionPolicy,
          guard,
          mkdir: this.deps.mkdir,
          access: this.deps.access,
          realpath: this.deps.realpath,
        });
        await this.deps.copyFile(
          source,
          destination.path,
          parsed.value.collisionPolicy === "overwrite"
            ? 0
            : fsConstants.COPYFILE_EXCL
        );
        items.push({
          artifactUrl: artifact.artifactUrl,
          requestedDestination: artifact.destination,
          destination: destination.path,
          status: "exported",
          renamed: destination.renamed,
        });
      } catch (error) {
        items.push({
          artifactUrl: artifact.artifactUrl,
          requestedDestination: artifact.destination,
          status: "failed",
          renamed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const exportedCount = items.filter(
      (item) => item.status === "exported"
    ).length;
    const failedCount = items.filter((item) => item.status === "failed").length;
    const cancelledCount = items.filter(
      (item) => item.status === "cancelled"
    ).length;
    const status: ExportGeneratedArtifactsResult["status"] =
      cancelledCount === items.length
        ? "cancelled"
        : exportedCount === items.length
        ? "completed"
        : exportedCount > 0
        ? "partial"
        : "failed";
    return {
      success: exportedCount > 0,
      result: {
        status,
        requestedCount: items.length,
        exportedCount,
        failedCount,
        cancelledCount,
        collisionPolicy: parsed.value.collisionPolicy,
        items,
      },
    };
  }
}

export const EXPORT_GENERATED_ARTIFACTS_TOOL: SkillDefinition = {
  name: "export_generated_artifacts",
  description:
    "Export AiFetchly-generated artifacts into the approved workspace without shell commands. " +
    "Use this only when the user wants persistent workspace files; generated artifacts are already displayed in chat without exporting. " +
    "Sources must be returned aifetchly-generated-image:// artifact URLs. Destinations are workspace-relative. " +
    "The default collision policy renames safely; overwrite is allowed only through this confirmed tool call. " +
    "Currently generated image artifacts are supported, with a generic contract for future artifact protocols.",
  parameters: {
    type: "object",
    properties: {
      artifacts: {
        type: "array",
        minItems: 1,
        maxItems: MAX_EXPORT_ITEMS,
        items: {
          type: "object",
          properties: {
            artifactUrl: {
              type: "string",
              description:
                "AiFetchly artifact protocol URL returned by a generation or processing tool.",
            },
            destination: {
              type: "string",
              description:
                "Optional workspace-relative output path. Defaults to generated-artifacts/<artifact filename>.",
            },
          },
          required: ["artifactUrl"],
          additionalProperties: false,
        },
      },
      collisionPolicy: {
        type: "string",
        enum: ["rename", "fail", "overwrite"],
        default: "rename",
      },
    },
    required: ["artifacts"],
    additionalProperties: false,
  },
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "filesystem",
  source: "built-in",
  timeoutClass: "fast",
  buildPermissionPreview,
  execute: async (args, context) => {
    const service = new ExportGeneratedArtifactsService();
    const response = await service.execute(args, context);
    return {
      success: response.success,
      result: response.result as unknown as Record<string, unknown>,
    };
  },
};
