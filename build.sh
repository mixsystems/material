#!/usr/bin/env bash
# Builds the patched material-components-web packages and @blox/material, then publishes the
# tarballs as a tagged commit (tarballs only, no history) of this repository's origin. npm downloads
# them from raw.githubusercontent.com. Published tags are never replaced, because lockfiles pin the
# tarball hashes: to publish a new build, bump "version" in bundle/package.json (0.17.0-ng22.1, ...).
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit your changes first: a published build must match a commit." >&2
  exit 1
fi
version=$(node -p "require('./bundle/package.json').version")
tag=dist-$version
repo=$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null; then
  echo "$tag is already published: bump \"version\" in bundle/package.json." >&2
  exit 1
fi

export RELEASE_URL=https://raw.githubusercontent.com/$repo/$tag/
(cd mdc-sass && npm ci && npm run build && npm run verify)
(cd bundle && npm ci && npm run build)

tree=$(for f in mdc-sass/dist/*.tgz "bundle/blox-material-$version.tgz"; do
  printf '100644 blob %s\t%s\n' "$(git hash-object -w "$f")" "$(basename "$f")"
done | git mktree)
commit=$(git commit-tree "$tree" -m "$tag (built from $(git rev-parse --short HEAD))")
git push origin "$commit:refs/tags/$tag"

echo
echo "Published. In the application's package.json:"
echo "  \"@blox/material\": \"${RELEASE_URL}blox-material-$version.tgz\""
