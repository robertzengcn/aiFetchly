/**
 * Empty shim for 'fs' in renderer build only.
 * Node built-ins must not be bundled in the renderer; this prevents dep-scan from failing.
 */
export default {};
