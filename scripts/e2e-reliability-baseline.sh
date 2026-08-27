#!/usr/bin/env bash
#
# E2E reliability baseline (TODO 10 / PRD NF-01, NF-02).
#
# Runs the Electron E2E suite N consecutive times under xvfb and reports the
# first-attempt pass rate + total wall time. A clean baseline is 20/20.
#
# Usage: scripts/e2e-reliability-baseline.sh [N]   (default N=20)
set -euo pipefail
N="${1:-20}"
PASSES=0
FAILS=0
START=$(date +%s)

for i in $(seq 1 "$N"); do
  echo "--- run $i/$N ---"
  if xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" \
    node_modules/.bin/playwright test --reporter=line 2>&1 | tail -1 | grep -q "passed"; then
    PASSES=$((PASSES + 1))
    echo "  PASS"
  else
    FAILS=$((FAILS + 1))
    echo "  FAIL"
  fi
done

END=$(date +%s)
echo ""
echo "=== RELIABILITY BASELINE ==="
echo "runs:     $N"
echo "passed:   $PASSES"
echo "failed:   $FAILS"
echo "duration: $((END - START))s"
echo "rate:     $(awk "BEGIN{printf \"%.1f\", ($PASSES/$N)*100}")%"
