import * as fs from "fs";
import * as path from "path";
import { isAiEnabled } from "@/service/AiFeatureGate";
import { PluginInstallService } from "@/service/PluginInstallService";
import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { broadcastAifetchlyConfigChanged } from "@/main-process/communication/aifetchlyConfigEvents";
import type { PluginSummary, PluginSourceKind } from "@/entityTypes/pluginTypes";
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";
import type {
  PluginMarketplaceSummary,
  InstallMarketplacePluginRequest,
} from "@/entityTypes/pluginMarketplaceTypes";

type FlagValue = string | true;

interface ParsedArguments {
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, FlagValue>;
}

type InstallTarget =
  | {
      readonly mode: "marketplace";
      readonly request: InstallMarketplacePluginRequest;
    }
  | {
      readonly mode: "source";
      readonly request: PluginSourceRequest;
    };

const MARKETPLACE_PLUGIN_ID = /^[a-z0-9][a-z0-9_-]*@[a-z0-9][a-z0-9_-]*$/;
const GITHUB_SHORTHAND = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9_.-]+$/i;

const INSTALL_SOURCE_KINDS: readonly PluginSourceKind[] = [
  "local-zip",
  "local-folder",
  "git",
  "github",
  "npm",
  "url",
];

const FLAG_ALIASES: Readonly<Record<string, string>> = {
  "--ref": "ref",
  "--overwrite": "overwrite",
  "--kind": "kind",
  "--npm-version": "npmVersion",
  "--registry": "npmRegistry",
  "--npm-registry": "npmRegistry",
  "--enable-after-install": "enableAfterInstall",
};

/**
 * Side-effectful handler for `/plugin ...` built-in slash commands.
 * Kept outside SlashCommandDispatcher so parsing/dispatch stays light and
 * the plugin install dependencies are only loaded when this command is used.
 */
export class PluginSlashCommandService {
  constructor(
    private readonly marketplaceService: PluginMarketplaceService = new PluginMarketplaceService(),
    private readonly installService: PluginInstallService = new PluginInstallService(),
    private readonly aiEnabled: () => boolean = isAiEnabled
  ) {}

  async execute(rawArgs: string | undefined): Promise<string> {
    if (!this.aiEnabled()) {
      return "AI feature is not enabled. Enable AI before managing plugins from chat.";
    }

    const parsed = parseArguments(rawArgs ?? "");
    const [group, action, ...rest] = parsed.positional;

    if (!group) {
      return renderUsage();
    }

    if (group === "marketplace" && action === "add") {
      return this.addMarketplace(rest, parsed.flags);
    }

    if (group === "install") {
      return this.installPlugin([action, ...rest].filter(Boolean), parsed.flags);
    }

    return renderUsage(`Unknown plugin command: ${[group, action].filter(Boolean).join(" ")}`);
  }

  private async addMarketplace(
    args: readonly string[],
    flags: ReadonlyMap<string, FlagValue>
  ): Promise<string> {
    const source = args[0];
    if (!source) {
      return renderUsage("Missing marketplace source.");
    }
    const marketplace = await this.marketplaceService.addMarketplace({
      source,
      ...(stringFlag(flags, "ref") ? { ref: stringFlag(flags, "ref") } : {}),
      ...(booleanFlag(flags, "overwrite") ? { overwrite: true } : {}),
    });
    return renderMarketplaceAdded(marketplace);
  }

  private async installPlugin(
    args: readonly string[],
    flags: ReadonlyMap<string, FlagValue>
  ): Promise<string> {
    const target = args[0];
    if (!target) {
      return renderUsage("Missing plugin identifier or source.");
    }

    const installTarget = resolveInstallTarget(target, flags);
    const plugin =
      installTarget.mode === "marketplace"
        ? await this.marketplaceService.installMarketplacePlugin(
            installTarget.request
          )
        : await installFromSource(this.installService, installTarget.request);

    await PluginComponentRegistryService.applyLoadedPlugins();
    broadcastAifetchlyConfigChanged({ source: "plugin" });
    return renderPluginInstalled(plugin, installTarget.mode);
  }
}

function parseArguments(raw: string): ParsedArguments {
  const tokens = tokenize(raw);
  const positional: string[] = [];
  const flags = new Map<string, FlagValue>();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    const rawFlag = eq === -1 ? token : token.slice(0, eq);
    const flagName = FLAG_ALIASES[rawFlag];
    if (!flagName) {
      throw new Error(`Unknown flag "${rawFlag}".`);
    }

    if (
      flagName === "overwrite" ||
      flagName === "enableAfterInstall"
    ) {
      flags.set(flagName, true);
      continue;
    }

    const value = eq === -1 ? tokens[i + 1] : token.slice(eq + 1);
    if (!value || value.startsWith("--")) {
      throw new Error(`Flag "${rawFlag}" requires a value.`);
    }
    if (eq === -1) i += 1;
    flags.set(flagName, value);
  }

  return { positional, flags };
}

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code === 10 || code === 13 || code <= 31) {
      if (!/\s/.test(char)) {
        throw new Error("Plugin command contains control characters.");
      }
    }

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (char === "'" || char === '"') {
      if (quote === char) {
        quote = null;
      } else if (!quote) {
        quote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += "\\";
  if (quote) {
    throw new Error("Plugin command has an unterminated quoted argument.");
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function resolveInstallTarget(
  target: string,
  flags: ReadonlyMap<string, FlagValue>
): InstallTarget {
  const overwrite = booleanFlag(flags, "overwrite");
  const ref = stringFlag(flags, "ref");
  const kind = normalizeKind(stringFlag(flags, "kind"));

  if (!kind && MARKETPLACE_PLUGIN_ID.test(target)) {
    const enableAfterInstall = booleanFlag(flags, "enableAfterInstall");
    return {
      mode: "marketplace",
      request: {
        pluginId: target,
        ...(overwrite ? { overwrite: true } : {}),
        ...(enableAfterInstall ? { enableAfterInstall: true } : {}),
      },
    };
  }

  const request = kind
    ? requestForExplicitKind(kind, target, flags)
    : inferSourceRequest(target, flags);
  return {
    mode: "source",
    request: {
      ...request,
      ...(overwrite ? { overwrite: true } : {}),
      ...(ref ? { ref } : {}),
    },
  };
}

function requestForExplicitKind(
  kind: PluginSourceKind,
  target: string,
  flags: ReadonlyMap<string, FlagValue>
): PluginSourceRequest {
  switch (kind) {
    case "local-zip":
      return { kind, zipPath: path.resolve(target) };
    case "local-folder":
      return { kind, folderPath: path.resolve(target) };
    case "git":
    case "github":
    case "url":
      return { kind, uri: normalizeGitHubShorthand(target, kind) };
    case "npm":
      return {
        kind,
        npmPackage: stripNpmPrefix(target),
        ...(stringFlag(flags, "npmVersion")
          ? { npmVersion: stringFlag(flags, "npmVersion") }
          : {}),
        ...(stringFlag(flags, "npmRegistry")
          ? { npmRegistry: stringFlag(flags, "npmRegistry") }
          : {}),
      };
  }
}

function inferSourceRequest(
  target: string,
  flags: ReadonlyMap<string, FlagValue>
): PluginSourceRequest {
  const lower = target.toLowerCase();
  const resolved = path.resolve(target);

  try {
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return { kind: "local-folder", folderPath: resolved };
      }
      if (stat.isFile() && lower.endsWith(".zip")) {
        return { kind: "local-zip", zipPath: resolved };
      }
    }
  } catch {
    // Fall through to shape-based source inference.
  }

  if (lower.endsWith(".zip") && !target.includes("://")) {
    return { kind: "local-zip", zipPath: resolved };
  }
  if (target.startsWith("npm:")) {
    return {
      kind: "npm",
      npmPackage: stripNpmPrefix(target),
      ...(stringFlag(flags, "npmVersion")
        ? { npmVersion: stringFlag(flags, "npmVersion") }
        : {}),
      ...(stringFlag(flags, "npmRegistry")
        ? { npmRegistry: stringFlag(flags, "npmRegistry") }
        : {}),
    };
  }
  if (
    target.startsWith("git@") ||
    target.startsWith("ssh://") ||
    target.startsWith("git://") ||
    lower.endsWith(".git")
  ) {
    return { kind: "git", uri: target };
  }
  if (target.startsWith("https://github.com/")) {
    return { kind: "github", uri: target };
  }
  if (target.startsWith("https://")) {
    return { kind: "url", uri: target };
  }
  if (GITHUB_SHORTHAND.test(target)) {
    return { kind: "github", uri: `https://github.com/${target}` };
  }

  throw new Error(
    "Could not infer plugin source. Use plugin@marketplace, a local folder, a .zip file, an HTTPS/Git URL, GitHub owner/repo, npm:<package>, or --kind."
  );
}

function normalizeKind(raw: string | undefined): PluginSourceKind | undefined {
  if (!raw) return undefined;
  const normalized =
    raw === "zip"
      ? "local-zip"
      : raw === "folder"
      ? "local-folder"
      : raw;
  if (INSTALL_SOURCE_KINDS.includes(normalized as PluginSourceKind)) {
    return normalized as PluginSourceKind;
  }
  throw new Error(`Unsupported plugin source kind "${raw}".`);
}

function normalizeGitHubShorthand(target: string, kind: PluginSourceKind): string {
  if (kind === "github" && GITHUB_SHORTHAND.test(target)) {
    return `https://github.com/${target}`;
  }
  return target;
}

function stripNpmPrefix(target: string): string {
  return target.startsWith("npm:") ? target.slice(4) : target;
}

async function installFromSource(
  service: PluginInstallService,
  request: PluginSourceRequest
): Promise<PluginSummary> {
  const result = await service.installFromSource(request);
  if (!result.success) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  return result.plugin;
}

function booleanFlag(flags: ReadonlyMap<string, FlagValue>, name: string): boolean {
  return flags.get(name) === true;
}

function stringFlag(
  flags: ReadonlyMap<string, FlagValue>,
  name: string
): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function renderUsage(prefix?: string): string {
  const lines = [
    "Plugin command usage:",
    "/plugin marketplace add <source> [--ref <ref>] [--overwrite]",
    "/plugin install <plugin@marketplace|source> [--overwrite] [--ref <ref>] [--kind <kind>]",
    "Sources can be local folders, .zip files, Git/GitHub/HTTPS URLs, GitHub owner/repo, or npm:<package>.",
  ];
  return prefix ? `${prefix}\n\n${lines.join("\n")}` : lines.join("\n");
}

function renderMarketplaceAdded(
  marketplace: PluginMarketplaceSummary
): string {
  return [
    `Marketplace "${marketplace.name}" added.`,
    `Plugins: ${marketplace.pluginCount}`,
    `Source: ${marketplace.sourceKind}`,
  ].join("\n");
}

function renderPluginInstalled(
  plugin: PluginSummary,
  mode: InstallTarget["mode"]
): string {
  return [
    `Plugin "${plugin.name}" installed from ${mode}.`,
    `Version: ${plugin.version}`,
    `Enabled: ${plugin.enabled ? "yes" : "no"}`,
    `Capabilities: ${plugin.skillCount} skills, ${plugin.mcpServerCount} MCP servers, ${plugin.agentCount} agents, ${plugin.commandCount} commands, ${plugin.hookCount} hooks.`,
  ].join("\n");
}
