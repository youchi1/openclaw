#!/usr/bin/env bash
# Publish the patched fork as @youchi1/openclaw without modifying tracked files.
# Usage: ./scripts/publish-headclaw.sh [version]
# Example: ./scripts/publish-headclaw.sh 2026.4.5-patched.2
set -euo pipefail

SCOPE_NAME="@youchi1/openclaw"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 2026.4.5-patched.1"
  exit 1
fi

# Discard known noisy files left over from previous failed publishes / builds
for f in src/canvas-host/a2ui/.bundle.hash package.json pnpm-lock.yaml; do
  if git diff --name-only | grep -qx "$f"; then
    git checkout "$f"
  fi
done

# Ensure logged in to npm
if ! npm whoami &>/dev/null; then
  echo "Not logged in to npm. Running npm login..."
  npm login
fi

# Ensure clean working tree so we can restore safely
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Always restore package.json on exit (success, failure, or interrupt)
restore() { git checkout package.json pnpm-lock.yaml 2>/dev/null; }
trap restore EXIT

echo "Publishing ${SCOPE_NAME}@${VERSION}..."

# Temporarily set scoped name + version + postinstall that restores the
# original "openclaw" name on disk after install. This is needed because
# upstream code resolves its own package root by checking package.json name.
npm pkg set "name=${SCOPE_NAME}" "version=${VERSION}"
# Include the rename script in the published package
node -e "const f=require('fs'),p=JSON.parse(f.readFileSync('package.json'));if(!p.files.includes('scripts/postinstall-rename.mjs')){p.files.push('scripts/postinstall-rename.mjs');f.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')}"
# Append the name-rewrite to whatever postinstall already exists.
ORIG_POSTINSTALL=$(node -e "const p=JSON.parse(require('fs').readFileSync('package.json'));console.log(p.scripts?.postinstall||'')")
if [ -n "$ORIG_POSTINSTALL" ]; then
  npm pkg set "scripts.postinstall=${ORIG_POSTINSTALL} && node scripts/postinstall-rename.mjs"
else
  npm pkg set "scripts.postinstall=node scripts/postinstall-rename.mjs"
fi

# Build
pnpm build

# Publish
npm publish --access public --tag latest

echo "Published ${SCOPE_NAME}@${VERSION}"
