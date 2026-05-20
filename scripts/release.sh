#!/usr/bin/env bash
set -euo pipefail

# One-stop release.
#
# Usage: scripts/release.sh <patch|minor|major|x.y.z>
#
#   scripts/release.sh patch     # 0.1.0 -> 0.1.1
#   scripts/release.sh minor     # 0.1.0 -> 0.2.0
#   scripts/release.sh 1.2.3     # explicit
#
# Flow:
#   1. validate clean tree + on main + up to date
#   2. typecheck, test, build  (fail fast before tagging)
#   3. npm version  -> bumps package.json, runs version-bump.mjs
#                      (updates manifest.json + versions.json),
#                      commits, tags (bare, signed via .npmrc)
#   4. git push --follow-tags  -> release.yml builds, attests,
#                                 and uploads main.js / manifest.json
#                                 to a draft GitHub release.

if [ $# -ne 1 ]; then
  echo "usage: $0 <patch|minor|major|x.y.z>" >&2
  exit 1
fi

bump="$1"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean — commit or stash first" >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "error: release must run from main (currently on $branch)" >&2
  exit 1
fi

git pull --ff-only

npm run typecheck
npm test
npm run build

# npm version:
#   - bumps package.json
#   - runs the "version" lifecycle script -> version-bump.mjs
#     (rewrites manifest.json + versions.json, stages them)
#   - commits with the tag message
#   - tags (bare + signed; see .npmrc)
new_version=$(npm version "$bump" --message "chore: release %s")
new_version="${new_version#v}"  # strip leading v if npm printed one

echo ""
echo "✓ bumped to $new_version (package.json, manifest.json, versions.json)"
echo "  pushing commit + tag..."

git push --follow-tags

echo ""
echo "✓ pushed — watch the release workflow:"
echo "    gh run watch"
echo "  then review the draft:"
echo "    gh release view $new_version --web"
