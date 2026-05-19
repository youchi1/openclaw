#!/usr/bin/env bash
# Build a local tarball of the patched fork — identical to what publish-headclaw.sh
# would publish, but written to a .tgz instead of pushed to npm. Use this to
# validate a fix on one VPS before running the real publish.
#
# Usage: ./.claude/scripts/pack-headclaw.sh [version]
# Example: ./.claude/scripts/pack-headclaw.sh 2026.5.7-patched.3
#
# Output: ./youchi1-openclaw-<version>.tgz in repo root.
#
# Install on the VPS:
#   scp youchi1-openclaw-<version>.tgz <vps>:/tmp/
#   ssh <vps> "npm install -g /tmp/youchi1-openclaw-<version>.tgz && systemctl restart <gateway-unit>"
#
# This is NOT a release. Once the build is proven on the test VPS, run
# `./.claude/scripts/publish-headclaw.sh <version>` to ship the same tag to
# all tenants via HeadClaw's OPENCLAW_VERSION rollout.
set -euo pipefail

SCOPE_NAME="@youchi1/openclaw"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 2026.5.7-patched.3"
  exit 1
fi

# Same branch invariant as publish-headclaw.sh: the version base must match the
# current patched branch so we never pack old source under a new version label.
VERSION_BASE="${VERSION%%-*}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
EXPECTED_BRANCH="patched/${VERSION_BASE}"
if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
  echo "Error: branch mismatch."
  echo "  Current branch:  $CURRENT_BRANCH"
  echo "  Version arg:     $VERSION (base: $VERSION_BASE)"
  echo "  Expected branch: $EXPECTED_BRANCH"
  exit 1
fi

# Discard known noisy files left over from previous failed builds.
for f in src/canvas-host/a2ui/.bundle.hash package.json pnpm-lock.yaml; do
  if git diff --name-only | grep -qx "$f"; then
    git checkout "$f"
  fi
done

# Ensure clean working tree so we can restore safely.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Always restore package.json on exit (success, failure, or interrupt).
restore() { git checkout package.json pnpm-lock.yaml 2>/dev/null; }
trap restore EXIT

echo "Packing ${SCOPE_NAME}@${VERSION} from ${CURRENT_BRANCH}..."

# Apply the same transient package.json changes as the publish script so the
# tarball matches what npm publish would emit.
npm pkg set "name=${SCOPE_NAME}" "version=${VERSION}"
node -e "const f=require('fs'),p=JSON.parse(f.readFileSync('package.json'));if(!p.files.includes('.claude/scripts/postinstall-rename.mjs')){p.files.push('.claude/scripts/postinstall-rename.mjs');f.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')}"
ORIG_POSTINSTALL=$(node -e "const p=JSON.parse(require('fs').readFileSync('package.json'));console.log(p.scripts?.postinstall||'')")
if [ -n "$ORIG_POSTINSTALL" ]; then
  npm pkg set "scripts.postinstall=${ORIG_POSTINSTALL} && node .claude/scripts/postinstall-rename.mjs"
else
  npm pkg set "scripts.postinstall=node .claude/scripts/postinstall-rename.mjs"
fi

# Build the same way publish does.
pnpm build

# npm pack writes the tarball to the cwd. The filename is derived from the
# scoped name + version: "@youchi1/openclaw" + "X.Y.Z-patched.N" becomes
# "youchi1-openclaw-X.Y.Z-patched.N.tgz".
TARBALL=$(npm pack 2>/dev/null | tail -n 1)

echo
echo "Packed: $(pwd)/${TARBALL}"
echo
echo "Install on a single VPS for testing:"
echo "  scp ${TARBALL} <vps>:/tmp/"
echo "  ssh <vps> 'npm install -g /tmp/${TARBALL} && <restart-gateway-cmd>'"
