#!/usr/bin/env sh
# Chunked eslint --fix for lint-staged.
#
# Why: with very large staged sets (e.g. a big merge committing ~500 files),
# lint-staged spawns ONE `npx eslint --fix <file...> <file...>` process whose
# argument list can exceed what the host sandbox will spawn, and the child is
# killed with SIGKILL before linting anything. Running the SAME eslint over
# the same files in batches keeps the guard intact on any host.
#
# Usage (lint-staged): "*.{js,ts,vue}": ["sh scripts/lint-staged-eslint.sh"]
# lint-staged appends the staged file list as trailing arguments.

set -e

BATCH=40
files=""
count=0
status=0

run_batch() {
  if [ "$count" -gt 0 ]; then
    # shellcheck disable=SC2086
    npx eslint --fix $files || status=1
  fi
  files=""
  count=0
}

for f in "$@"; do
  files="$files $f"
  count=$((count + 1))
  if [ "$count" -ge "$BATCH" ]; then
    run_batch
  fi
done
run_batch

exit $status
