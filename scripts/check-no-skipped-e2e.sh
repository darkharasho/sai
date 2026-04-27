#!/usr/bin/env bash
# Fail if any test.skip( call appears in tests/e2e/*.spec.ts.
# Tests should either be run or deleted — never silently skipped.
set -euo pipefail

if grep -rEn "test\.skip\(" tests/e2e --include="*.spec.ts"; then
  echo ""
  echo "ERROR: Found test.skip( in e2e specs. Either fix the test or delete it."
  exit 1
fi
echo "OK: no test.skip in e2e specs."
