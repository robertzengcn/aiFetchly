/**
 * App name and version from package.json (single source of truth).
 * Used for layout display when main-process app info is not yet available.
 */
import packageJson from '../../package.json';

const pkg = packageJson as { name?: string; version?: string };

export const packageAppName: string = pkg.name ?? 'aiFetchly';
export const packageVersion: string = pkg.version ?? '1.0.0';
