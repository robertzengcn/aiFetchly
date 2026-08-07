/**
 * Empty shim for 'fs' in renderer build only.
 * Node built-ins must not be bundled in the renderer; this prevents dep-scan from failing.
 */
function unsupportedFsApi(name: string): never {
  throw new Error(`${name} is not available in the renderer process`);
}

export function readFileSync(..._args: unknown[]): never {
  return unsupportedFsApi("fs.readFileSync");
}

export function readdirSync(..._args: unknown[]): never {
  return unsupportedFsApi("fs.readdirSync");
}

export function statSync(..._args: unknown[]): never {
  return unsupportedFsApi("fs.statSync");
}

export function writeFile(..._args: unknown[]): never {
  return unsupportedFsApi("fs.writeFile");
}

export function writeFileSync(..._args: unknown[]): never {
  return unsupportedFsApi("fs.writeFileSync");
}

export function existsSync(..._args: unknown[]): never {
  return unsupportedFsApi("fs.existsSync");
}

export function mkdirSync(..._args: unknown[]): never {
  return unsupportedFsApi("fs.mkdirSync");
}

export function rmSync(..._args: unknown[]): never {
  return unsupportedFsApi("fs.rmSync");
}

export default {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFile,
  writeFileSync,
};
