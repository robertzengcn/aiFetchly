/**
 * Electron moved extension APIs from Session to Session.extensions
 * (Electron 35+). electron-devtools-installer@3 still calls the deprecated
 * Session.loadExtension / getAllExtensions / removeExtension helpers, which
 * emit deprecation warnings on Electron 43.
 *
 * Forward those Session methods to session.extensions so the installer keeps
 * working without the warning. Safe no-op when extensions API is unavailable.
 */

type ExtensionInfo = { id: string; name: string };

type ExtensionLoadOptions = {
  allowFileAccess?: boolean;
};

type SessionExtensionsApi = {
  loadExtension: (
    path: string,
    options?: ExtensionLoadOptions
  ) => Promise<ExtensionInfo>;
  removeExtension: (extensionId: string) => void;
  getExtension: (extensionId: string) => ExtensionInfo | null;
  getAllExtensions: () => ExtensionInfo[];
};

type PatchableSession = {
  extensions?: SessionExtensionsApi;
  loadExtension?: SessionExtensionsApi["loadExtension"];
  removeExtension?: SessionExtensionsApi["removeExtension"];
  getExtension?: SessionExtensionsApi["getExtension"];
  getAllExtensions?: SessionExtensionsApi["getAllExtensions"];
};

function defineForwardedMethod(
  target: PatchableSession,
  method: keyof SessionExtensionsApi,
  extensions: SessionExtensionsApi
): void {
  Object.defineProperty(target, method, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: (...args: unknown[]) => {
      const fn = extensions[method] as (...fnArgs: unknown[]) => unknown;
      return fn.apply(extensions, args);
    },
  });
}

export function patchSessionExtensionsApi(targetSession: unknown): boolean {
  const ses = targetSession as PatchableSession;
  const extensions = ses.extensions;
  if (!extensions || typeof extensions.loadExtension !== "function") {
    return false;
  }

  defineForwardedMethod(ses, "loadExtension", extensions);
  defineForwardedMethod(ses, "removeExtension", extensions);
  defineForwardedMethod(ses, "getExtension", extensions);
  defineForwardedMethod(ses, "getAllExtensions", extensions);
  return true;
}
