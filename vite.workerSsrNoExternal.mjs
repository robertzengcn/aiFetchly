/**
 * Shared ssr.noExternal lists for Electron worker Vite configs.
 *
 * Packaged workers under app.asar.unpacked cannot reliably resolve pure-JS
 * packages that only exist inside app.asar/node_modules. Force-bundle these
 * graphs instead of relying on NODE_PATH. Keep native/heavy deps external and
 * allowlist them in scripts/verify-packaged-childprocess.js.
 */

export const ZOD_SSR_NO_EXTERNAL = ["zod"];

export const UUID_SSR_NO_EXTERNAL = ["uuid"];

export const SANITIZE_HTML_SSR_NO_EXTERNAL = [
  "sanitize-html",
  "htmlparser2",
  "escape-string-regexp",
  "is-plain-object",
  "deepmerge",
  "parse-srcset",
  "postcss",
  "launder",
  "entities",
  "domhandler",
  "domutils",
  "domelementtype",
  "dom-serializer",
  "nanoid",
  "picocolors",
  "source-map-js",
  "dayjs",
];

export const TURNDOWN_SSR_NO_EXTERNAL = ["turndown", "@mixmark-io/domino"];
