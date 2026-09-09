# Local AI Runtime CI

Downloadable embedding (`embedding-xenova`) and voice (`voice-sherpa`) archives
are **not** part of the Windows/macOS installer. The app fetches them later from
a stable GitHub Release catalog:

`https://github.com/<repo>/releases/download/<releaseTag>/local-ai-runtimes.json`

The default `releaseTag` lives in `src/config/localAiRuntimeRelease.json`. Changing
the app version does **not** require new runtime ZIPs.

## Two workflows

| Workflow | When | What it publishes |
|---|---|---|
| `.github/workflows/release.yml` | App ship (`gh workflow run release.yml -f build_mode=production`) | Windows/macOS installers and auto-update assets |
| `.github/workflows/local-ai-runtime-release.yml` | Runtime fingerprint change, or a manual dispatch | Six runtime ZIPs + `local-ai-runtimes.json` + `runtime-fingerprint.json` |

Do not put the four-OS runtime matrix back into `release.yml`. That job is the
slow path and it is not needed for an installer-only release.

## When CI rebuilds automatically

Pushes to `master` that touch runtime-related paths start a **cheap detect
job** (`should-rebuild`). That job does **not** install `node_modules`. It
computes a fingerprint and compares it to `runtime-fingerprint.json` on the
published runtime tag.

The heavy matrix (Windows x64, macOS x64, macOS arm64, Linux x64) runs only
when the fingerprint moved.

The fingerprint includes:

| Input | Why it matters |
|---|---|
| Resolved `electron` version in `yarn.lock` | NODE_MODULE_ABI follows Electron |
| `@xenova/transformers`, `onnxruntime-node`, `onnxruntime-common`, `sharp` | Embedding runtime closure |
| `sherpa-onnx-node` and the four `sherpa-onnx-<os>-<arch>` packages | Voice runtime closure |
| Embedding worker sources, probe worker, Vite worker config, packaging scripts | Contents of the ZIPs |
| `src/config/localAiRuntimeRelease.json` | `runtimeVersion`, `minAppVersion`, `releaseTag` |
| `.github/workflows/local-ai-runtime-release.yml` | Build flags that can change the archives |

Unrelated `yarn.lock` churn (UI libraries, tests, and so on) still trips the
path filter, then the detect job exits without starting the matrix.

## Version config

```json
{
  "releaseTag": "local-ai-runtime-v1.0.0",
  "runtimeVersion": "1.0.0",
  "minAppVersion": "1.0.0"
}
```

- `releaseTag` is the GitHub Release the desktop app downloads. Keep this
  stable unless you also ship an app that reads a new tag
  (`AIFETCHLY_RUNTIME_RELEASE_TAG` can override it).
- `runtimeVersion` is embedded in archive names such as
  `embedding-runtime-win32-x64-1.0.0.zip`. **Bump this when Electron ABI or
  native runtime packages change** so the new ZIPs do not overwrite the old
  filenames on the same tag.
- `minAppVersion` is the oldest app that may install the new archives.

The detect job reads this file. Dispatch inputs override it when you type
non-empty values in the Actions UI.

## Manual rebuild

Always rebuilds, even if the fingerprint matches:

```bash
gh workflow run local-ai-runtime-release.yml --ref master \
  -f publish_github_release=true
```

Override versions when cutting a new runtime generation:

```bash
gh workflow run local-ai-runtime-release.yml --ref master \
  -f release_tag=local-ai-runtime-v1.0.0 \
  -f runtime_version=1.1.0 \
  -f min_app_version=1.0.0 \
  -f publish_github_release=true
```

Also bump `runtimeVersion` (and `minAppVersion` if needed) in
`src/config/localAiRuntimeRelease.json` so later detect runs stay in sync.

Build without publishing (inspect artifacts on the run page):

```bash
gh workflow run local-ai-runtime-release.yml --ref master \
  -f publish_github_release=false
```

## First publish after this wiring

Until `runtime-fingerprint.json` exists on the runtime tag, every matching
`master` push rebuilds. After the first successful publish, later pushes skip
the matrix unless the fingerprint changes.

## Local check

```bash
node scripts/should-rebuild-local-ai-runtime.mjs \
  --write-fingerprint /tmp/runtime-fingerprint.json \
  --published-fingerprint /tmp/runtime-fingerprint.json
```

That prints `rebuild=false` when the two documents match. Omit
`--published-fingerprint` to compare against the live GitHub Release (needs
`gh` auth).

## Related docs

- `docs/RELEASE_COMMANDS.md` — app installer commands
- `docs/RELEASE_WORKFLOW.md` — installer workflow guarantees
- `docs/prd/downloadable-local-ai-runtimes-prd.md` — product contract
- `docs/prd/downloadable-local-ai-runtimes-technical-design.md` — packaging design
