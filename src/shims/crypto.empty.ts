/**
 * Empty shim for 'crypto' in renderer build only.
 * Node built-ins must not be bundled in the renderer; this prevents dep-scan from failing.
 */
function unsupportedCryptoApi(name: string): never {
  throw new Error(`${name} is not available in the renderer process`);
}

export function randomBytes(): never {
  return unsupportedCryptoApi("crypto.randomBytes");
}

export function createHash(): never {
  return unsupportedCryptoApi("crypto.createHash");
}

export function randomUUID(): never {
  return unsupportedCryptoApi("crypto.randomUUID");
}

export default {
  randomBytes,
  createHash,
  randomUUID,
};
