# Plugin Author Note — Distributing on GitHub

Audience: plugin authors who publish AiFetchly plugins on GitHub. Goal:
make `Install from Source → GitHub` (or a pasted GitHub URL) install your
plugin cleanly for every user, with no Git and no token on their machine.

Related: `docs/skill-installation-operations.md` (operator view),
`docs/prd/git-free-github-plugin-installation-prd.md` (requirements).

## How AiFetchly installs from GitHub

1. The user pastes your repository URL (optionally with a branch/tag/commit
   in the **Ref** field).
2. AiFetchly resolves that ref to an **immutable commit SHA** via the
   public GitHub API, then downloads **that exact commit** as a zipball.
   A later push to the branch can never change what gets installed mid-flight.
3. The zipball contains a single generated wrapper directory
   `<repo>-<sha>/`. AiFetchly unwraps it automatically — your plugin root
   (`plugin.json` / `.claude-plugin/plugin.json`) must sit at the
   repository root, exactly like a normal clone.
4. The pinned SHA is stored with the installed plugin and shown (shortened)
   in the Plugin Manager overview.

## Recommendations

- **Pin installs to a commit or tag.** Ask users to put a tag (or full
  commit SHA) in the **Ref** field for reproducible installs. Leaving the
  ref empty installs the default branch's current head.
- **Ship large or LFS-backed content as a release asset.** GitHub zipballs
  **omit submodule contents and Git LFS files** (they arrive as pointer
  text). If your plugin needs those files, publish a `.zip` release asset
  containing the complete plugin and give users the
  `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>.zip`
  URL (or `.../releases/latest`, which resolves the asset named
  `plugin.zip`).
- **Keep the package small.** Installs enforce the same limits as zip
  imports (max archive bytes, file count, extracted size). Release assets
  over the limit fail with a clear, non-recoverable error.
- **Public repos only.** The GitHub source is unauthenticated in v1;
  private repositories cannot be installed this way. For a private plugin,
  distribute a zip file or a git URL the user clones locally.
- **Don't rely on network at install time.** Installs are validated,
  copied, and registered — they never execute your code, and post-install
  first-run downloads should be documented, not assumed.

## Quick checklist

| Check | Why |
|---|---|
| `plugin.json` at repo root (or `.claude-plugin/plugin.json`) | Wrapper unwrap expects the repo root |
| Valid manifest (name/version/skills or mcpServers or agents) | Empty component lists are rejected |
| Tagged releases for stable installs | Users pin the tag in **Ref** |
| Release asset zip for LFS/submodule content | Zipballs omit those files |
