/** Inert os for the component-test environment (see ./fs.ts). */
const osStub = {
  tmpdir: (): string => "/tmp",
  homedir: (): string => "/tmp",
  hostname: (): string => "localhost",
  platform: (): string => "linux",
  release: (): string => "0",
  EOL: "\n",
} as Record<string, unknown>;

export default osStub;
export const tmpdir = osStub.tmpdir as () => string;
export const homedir = osStub.homedir as () => string;
export const hostname = osStub.hostname as () => string;
export const platform = osStub.platform as () => string;
export const release = osStub.release as () => string;
export const EOL = "\n";
