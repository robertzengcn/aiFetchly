/**
 * Empty shim for 'fs' in renderer build only.
 * Node built-ins must not be bundled in the renderer; this prevents dep-scan from failing.
 */
function unsupportedFsApi(name: string): never {
  throw new Error(`${name} is not available in the renderer process`);
}

export function readFileSync(): never {
  return unsupportedFsApi("fs.readFileSync");
}

export default {
  readFileSync,
};
