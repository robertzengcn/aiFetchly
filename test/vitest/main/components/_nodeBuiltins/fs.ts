/**
 * Node-builtin stubs for the component-test environment.
 *
 * happy-dom cannot resolve Node builtins (see the header comment in
 * vitest.config.mjs). Services that component tests mount transitively
 * (Logger via AIChat* services) import `fs`, `os`, and `path`, so this
 * directory provides inert replacements. Component tests never rely on
 * real filesystem/logging side effects.
 */
type AnyFn = (...args: unknown[]) => unknown;

/** Inert fs: every method is a no-op returning a plausible value. */
const fsStub = {
  existsSync: (): boolean => true,
  mkdirSync: (): void => undefined,
  readFileSync: (): string => "",
  readdirSync: (): string[] => [],
  rmSync: (): void => undefined,
  appendFileSync: (): void => undefined,
  writeFileSync: (): void => undefined,
  statSync: () => ({ isDirectory: () => false, isFile: () => true }),
} as Record<string, AnyFn>;

export default fsStub;
export const existsSync = fsStub.existsSync;
export const mkdirSync = fsStub.mkdirSync;
export const readFileSync = fsStub.readFileSync;
export const readdirSync = fsStub.readdirSync;
export const rmSync = fsStub.rmSync;
export const appendFileSync = fsStub.appendFileSync;
export const writeFileSync = fsStub.writeFileSync;
export const statSync = fsStub.statSync;
