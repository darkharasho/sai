#!/usr/bin/env bash
# Publishes a Capacitor web bundle as an over-the-air update (Capgo, self-hosted on GitHub
# releases) for one native release, after checking that nothing native changed since it.
#
# Usage: ota-publish.sh <ios|android> <NAME+NUMBER> <web-dir> [--native-paths "ios android ..."]
#                       [--tag-prefix native] [--dry-run]
#
#   <NAME+NUMBER>   The native release (its tag <prefix>/<platform>/<NAME+NUMBER> must exist). NUMBER
#                   is the build number the installed app reports (App.getInfo().build).
#   <web-dir>       The built web app for that platform, index.html at its root.
#   --native-paths  Paths whose changes need a native release (default: "<platform> capacitor.config.ts").
#
# Native check: the Capacitor plugins in package.json (@capacitor/*, @capgo/*, capacitor-*,
# cordova-*; names and versions) and --native-paths must match the native release's tag, else it
# stops: that change needs a store release (an update can't add native code).
#
# Hosting: prerelease ota-<platform>-<NUMBER> (never "latest", so desktop updaters ignore it), with
# assets bundle-<version>.zip and manifest.json {version, url, checksum (sha256), native, build,
# commit, published}. Each publish replaces the previous bundle. The app reads
# https://github.com/<repo>/releases/download/ota-<platform>-<NUMBER>/manifest.json (live-update.ts).
#
# Env: GH_TOKEN (contents: write), GITHUB_REPOSITORY (owner/repo; default: gh's current repo).
set -euo pipefail
platform="" release="" dir="" paths="" prefix=native dry=false
while [ $# -gt 0 ]; do
  case "$1" in
    --native-paths) paths="$2"; shift 2 ;;
    --tag-prefix) prefix="$2"; shift 2 ;;
    --dry-run) dry=true; shift ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) if [ -z "$platform" ]; then platform="$1"; elif [ -z "$release" ]; then release="$1"; else dir="$1"; fi; shift ;;
  esac
done
[[ "$platform" =~ ^(ios|android)$ ]] || { echo "platform must be ios or android" >&2; exit 2; }
[[ "$release" =~ ^([0-9]+\.[0-9]+\.[0-9]+)\+([0-9]+)$ ]] || { echo "release must be NAME+NUMBER" >&2; exit 2; }
name="${BASH_REMATCH[1]}" number="${BASH_REMATCH[2]}"
[ -f "$dir/index.html" ] || { echo "$dir/index.html not found" >&2; exit 2; }
paths="${paths:-$platform capacitor.config.ts}"
repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
tag="$prefix/$platform/$release"

git fetch -q --depth=1 origin "refs/tags/$tag:refs/tags/$tag" 2>/dev/null || git rev-parse -q --verify "refs/tags/$tag" >/dev/null \
  || { echo "::error::No tag $tag: $release isn't a shipped native release." >&2; exit 1; }
plugins() {
  python3 -c '
import json, re, sys
p = json.load(sys.stdin)
deps = {**p.get("dependencies", {}), **p.get("devDependencies", {})}
pat = re.compile(r"^(@capacitor/|@capgo/|@capacitor-community/|capacitor-|cordova-)")
print(json.dumps({k: v for k, v in sorted(deps.items()) if pat.match(k) and k != "@capacitor/cli"}))'
}
if [ "$(git show "$tag:package.json" | plugins)" != "$(plugins < package.json)" ]; then
  echo "::error::Capacitor plugins changed since $tag; ship a native release instead." >&2
  diff <(git show "$tag:package.json" | plugins | python3 -m json.tool) <(plugins < package.json | python3 -m json.tool) >&2 || true
  exit 1
fi
# A shallow CI checkout needs the history back to the tag to diff against it; never deepen or
# shallow-ify a full clone.
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  git fetch -q --shallow-since="$(git log -1 --format=%cI "$tag")" origin 2>/dev/null || true
fi
# shellcheck disable=SC2086
if ! git diff --quiet "$tag" HEAD -- $paths; then
  echo "::error::Native files changed since $tag ($paths); ship a native release instead." >&2
  git diff --stat "$tag" HEAD -- $paths >&2; exit 1
fi

commit="$(git rev-parse --short=7 HEAD)"
version="$name-ota.$(( $(date +%s) / 60 )).$commit"
out="$(mktemp -d)"; zip="$out/bundle-$version.zip"
(cd "$dir" && zip -qr -X "$zip" .)
sum="$(sha256sum "$zip" | cut -d' ' -f1)"
otatag="ota-$platform-$number"
url="https://github.com/$repo/releases/download/$otatag/bundle-$version.zip"
python3 - "$out/manifest.json" <<PY
import json, sys, datetime
json.dump({"version": "$version", "url": "$url", "checksum": "$sum", "native": "$name",
           "build": "$number", "commit": "$commit",
           "published": datetime.datetime.now(datetime.timezone.utc).isoformat()},
          open(sys.argv[1], "w"), indent=2)
PY
cat "$out/manifest.json"
$dry && { echo "Dry run: not published."; exit 0; }

if ! gh release view "$otatag" -R "$repo" >/dev/null 2>&1; then
  gh release create "$otatag" -R "$repo" --prerelease --latest=false --target "$(git rev-parse "$tag^{commit}")" \
    --title "Live updates for $platform $release" \
    --notes "Over-the-air web bundles for the $platform build $release. Not an app download."
fi
gh release upload "$otatag" "$zip" -R "$repo" --clobber
gh release upload "$otatag" "$out/manifest.json" -R "$repo" --clobber   # last: the app sees the new bundle only now
for old in $(gh release view "$otatag" -R "$repo" --json assets -q '.assets[].name' | grep '^bundle-' | grep -vxF "bundle-$version.zip"); do
  gh release delete-asset "$otatag" "$old" -R "$repo" -y
done
echo "Published $version for $platform $release"
