# Local AI runtime release (quick commands)

Canonical guide: [`docs/ci/local-ai-runtime-release.md`](ci/local-ai-runtime-release.md)

```bash
# Automatic: push to master when the runtime fingerprint changes.
# Manual: always rebuilds, even if the fingerprint matches.
gh workflow run local-ai-runtime-release.yml --ref master \
  -f publish_github_release=true

# New runtime generation (also bump src/config/localAiRuntimeRelease.json)
gh workflow run local-ai-runtime-release.yml --ref master \
  -f release_tag=local-ai-runtime-v1.0.0 \
  -f runtime_version=1.1.0 \
  -f min_app_version=1.0.0 \
  -f publish_github_release=true
```
