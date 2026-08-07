# AiFetchly Native-Messaging Host Packaging (DEFERRED)

The native-messaging host is the local relay between the Chromium extension and
the AiFetchly desktop main process. Its runtime code lives at
`src/childprocess/browserProfileNativeHost.ts` (framing, size cap, schema
validation; relay-only — no Electron, SQLite, or key access).

## Status: not yet shipped

What remains is OS packaging + installer registration of the native-messaging
manifest (technical-design Open Implementation Decision #1). Until that exists,
`BROWSER_PROFILE_IMPORT_FLAG` stays OFF and the desktop transport
(`BrowserImportCoordinator` default `NativeHostTransport.announceRequest`) is a
no-op.

## Registration assets (to be produced)

- **Windows**: `HKCU\Software\Google\Chrome\NativeMessagingHosts\<host>` → path to
  `aifetchly-browser-import-host.json`.
- **macOS / Linux**: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<host>.json`
  and `/etc/opt/chrome/native-messaging-hosts/<host>.json` (and the equivalent
  Edge / Brave paths).

The manifest template (allowed-extension-ids, native executable path) will be
generated at build time from the reviewed platform manifest so the host only
accepts the production AiFetchly extension ID.
