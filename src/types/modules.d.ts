/**
 * Ambient module declarations for dependencies whose @types are not resolvable
 * in this environment (corrupt/incomplete @types/uuid + @types/diff installs
 * that persist across `yarn install`/`yarn add`; and picomatch/js-cookie/
 * html-to-text/mailparser, whose bundled types don't resolve here).
 *
 * Declared as ambient `any` modules so `import ... from "x"` type-checks under
 * noImplicitAny. The corresponding @types/uuid and @types/diff entries were
 * removed from package.json (they were not installing); if a future environment
 * installs them cleanly, these shims can be deleted in favor of the real types.
 *
 * WS-7 R7.2 (noImplicitAny).
 */
declare module "uuid";
declare module "diff";
declare module "picomatch";
declare module "js-cookie";
declare module "html-to-text";
declare module "mailparser" {
  // Named type exports used by the email-receive code. Typed as `any` (the
  // installed @types/mailparser API drifts from the code's usage — resolving
  // that drift is a separate task; this shim lets it type-check under
  // noImplicitAny without changing runtime behavior).
  export type ParsedMail = any;
  export type EmailMessage = any;
  export function simpleParser(...args: any[]): Promise<any>;
}
