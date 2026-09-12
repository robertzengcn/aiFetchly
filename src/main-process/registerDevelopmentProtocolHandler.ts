import * as os from "os";
import * as path from "path";

export interface ProtocolRegistryClient {
  getDefaultApp(protocol: string): Promise<string | null>;
  register(
    protocol: string,
    command: string,
    options: {
      override?: boolean;
      terminal?: boolean;
      appName?: string;
    }
  ): Promise<unknown>;
  deRegister(protocol: string, options?: { force?: boolean }): Promise<unknown>;
}

export type RegisterDevelopmentProtocolResult =
  | { status: "registered" }
  | { status: "refreshed"; defaultApp: string }
  | { status: "skipped-external"; defaultApp: string };

export interface RegisterDevelopmentProtocolInput {
  protocolScheme: string;
  command: string;
  appName: string;
  protocolRegistry: ProtocolRegistryClient;
  protocolRegistryHome?: string;
}

/**
 * True when `targetPath` is the directory itself or a descendant of it.
 * Rejects `..` escapes so a handler under /Applications cannot be treated as
 * a protocol-registry wrapper.
 */
export function isPathInsideDirectory(
  targetPath: string,
  directory: string
): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedDirectory = path.resolve(directory);
  const relative = path.relative(resolvedDirectory, resolvedTarget);
  return (
    relative === "" ||
    (relative.length > 0 &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/**
 * Register `scheme://` for unpackaged Electron. Never use protocol-registry
 * `override: true`: that deRegisters with force=false and tries to rewrite
 * another app's Info.plist, which macOS 13+ blocks with
 * "Permission Denied. Use force option or get App Management Permissions".
 *
 * If the current handler is our `~/.protocol-registry` wrapper, delete that
 * wrapper (force) and recreate it so the command tracks this Electron binary.
 * If some other app owns the scheme, leave it alone.
 */
export async function registerDevelopmentProtocolHandler(
  input: RegisterDevelopmentProtocolInput
): Promise<RegisterDevelopmentProtocolResult> {
  const protocolRegistryHome =
    input.protocolRegistryHome ??
    path.join(os.homedir(), ".protocol-registry");
  const existingApp = await input.protocolRegistry.getDefaultApp(
    input.protocolScheme
  );

  if (
    existingApp &&
    !isPathInsideDirectory(existingApp, protocolRegistryHome)
  ) {
    return { status: "skipped-external", defaultApp: existingApp };
  }

  if (existingApp) {
    await input.protocolRegistry.deRegister(input.protocolScheme, {
      force: true,
    });
  }

  await input.protocolRegistry.register(input.protocolScheme, input.command, {
    override: false,
    appName: input.appName,
    terminal: true,
  });

  if (existingApp) {
    return { status: "refreshed", defaultApp: existingApp };
  }
  return { status: "registered" };
}
