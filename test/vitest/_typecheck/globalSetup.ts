/**
 * Vitest globalSetup: runs `tsc --noEmit` before any test executes.
 *
 * Why: Vitest uses esbuild's transpile-only mode, which strips types
 * without checking them. Type errors therefore don't fail test runs.
 * This bit us during the zod schema rollout (commit history has the
 * fix). To prevent recurrence, every vitest config that touches typed
 * source code references this file via `test.globalSetup`.
 *
 * Behavior:
 *  - tsc exits 0 -> setup resolves, tests proceed normally
 *  - tsc exits non-zero -> setup throws, vitest aborts the whole run
 *
 * The TSC binary is invoked through node_modules/.bin/tsc so this works
 * in worktrees and CI without depending on a global install.
 *
 * Performance: tsc on this project takes ~5-15s cold, ~1-3s warm. The
 * cost runs once per vitest invocation, not per test file.
 *
 * Env opt-out:
 *   AIFETCHLY_SKIP_TSC=1 yarn testmain   # bypass typecheck (NOT recommended)
 * Useful for very tight inner loops where you know types are clean.
 */
import { execFileSync } from 'child_process'
import * as path from 'path'

export default function setup(): void {
  if (process.env.AIFETCHLY_SKIP_TSC === '1') {
    // eslint-disable-next-line no-console
    console.log('[typecheck] AIFETCHLY_SKIP_TSC=1 set, skipping tsc gate')
    return
  }

  const tscBin = path.resolve(__dirname, '../../../node_modules/.bin/tsc')
  const projectRoot = path.resolve(__dirname, '../../..')
  const tsconfig = path.join(projectRoot, 'tsconfig.json')

  // eslint-disable-next-line no-console
  console.log(`[typecheck] running tsc --noEmit -p ${path.relative(process.cwd(), tsconfig)}`)

  try {
    execFileSync(tscBin, ['--noEmit', '-p', tsconfig], {
      cwd: projectRoot,
      stdio: 'pipe', // capture stdout/stderr; we'll format below
      timeout: 180_000, // hard cap; tsc should finish well under this
    })
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number }
    const stdout = e.stdout?.toString('utf8') ?? ''
    const stderr = e.stderr?.toString('utf8') ?? ''
    const combined = (stdout + stderr).trim()
    // Surface the tsc output regardless of which stream vitest decides to show
    // eslint-disable-next-line no-console
    console.error('[typecheck] TypeScript errors detected:\n' + combined)
    // Throwing aborts the whole vitest run. Tests don't execute.
    throw new Error(
      `tsc --noEmit failed (exit ${e.status ?? 'unknown'}). ` +
        `Fix type errors above, or bypass with AIFETCHLY_SKIP_TSC=1 (not recommended).`,
    )
  }
}
