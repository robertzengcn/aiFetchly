# codesign retry shim

A single-purpose `codesign` shim for the `release.yml` `build-macos` job.

## Why it exists

`@electron/osx-sign` signs every file in the .app bundle with a per-file
`codesign ... --timestamp ...` call. Each call round-trips Apple's remote
timestamp service (`timestamp.apple.com`). That service intermittently returns
`The timestamp service is not available` when GHA macOS runners hit it under
load. One transient failure aborts the whole `Finalizing package` step and the
~2h build dies — see runs 09-21, 09-27, 09-28, 10-02 (run #100).

`--timestamp` cannot simply be dropped: Apple notarization (which production
builds run via `osxNotarize`) requires a secure timestamp on every Developer ID
signature. Untimestamped signatures are rejected at notarization with
`The signature does not include a secure timestamp`.

## How it works

The shim is placed first on `PATH` for the build step. `@electron/osx-sign`
invokes `codesign` via bare name (`child.execFile('codesign', ...)`), so Node's
PATH lookup resolves to this shim instead of `/usr/bin/codesign`. The shim:

1. Execs `/usr/bin/codesign` with all arguments.
2. On failure, if the combined output contains
   `The timestamp service is not available`, retries with backoff
   (default: 5 attempts, 30s between tries).
3. Otherwise exits with the real `codesign` exit code — all other errors
   ( entitlements, keychain, bad arguments, ...) pass through untouched, so a
   real failure still fails the build loudly.

## Configuration

- `CODESIGN_SHIM_RETRIES` — max attempts after the first try (default `5`).
- `CODESIGN_SHIM_BACKOFF_SECONDS` — seconds to sleep between attempts
  (default `30`).

Both are read by the shim at run time; no workflow change is needed to tune
them.

## Wiring

`.github/workflows/release.yml` (`build-macos` > `Build application`) prepends
`$GITHUB_WORKSPACE/scripts/codesign-retry-shim` to `PATH` before running the
packaging guard. The MAS job (`build-macos-store`) is untouched: its
`timestamp: "none"` path never calls the timestamp service.
