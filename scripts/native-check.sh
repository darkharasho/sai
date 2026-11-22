#!/usr/bin/env bash
# Usage: native-check.sh <ios|android> <NAME+NUMBER>
# Exits 0 when nothing native changed since that native release (tag native/<platform>/<NAME+NUMBER>),
# so an over-the-air update from HEAD can reach it: the same check ota.yml runs before publishing.
# scripts/review-required.sh runs it to tell whether a version has to be App Store reviewed.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$here/ota-publish.sh" "$1" "$2" --check-only --native-paths "mobile/$1 capacitor.config.ts"
