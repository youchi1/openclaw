# OpenClaw — HeadClaw Patched Fork

This is a **thin fork** of [openclaw/openclaw](https://github.com/openclaw/openclaw). We do NOT diverge from upstream — we only cherry-pick fixes from unmerged PRs and apply them on top of release tags.

## Purpose

HeadClaw installs OpenClaw on customer VPS machines via `npm install -g`. Upstream has thousands of unmerged PRs with real bug fixes. This fork lets us ship those fixes to customers while staying aligned with upstream releases.

## Repository Layout

- **`upstream` remote** — `openclaw/openclaw` (read-only, fetch tags/branches)
- **`origin` remote** — `youchi1/openclaw` (our fork, push here)
- **`main` branch** — synced with upstream main, do NOT commit here
- **`patched/X.Y.Z` branches** — release tag + cherry-picked fixes (this is where we work)

## Rules

1. **Never modify upstream code directly** — only cherry-pick commits from existing upstream PR branches
2. **Keep the patch list small** — only cherry-pick what HeadClaw actually needs, not "nice to haves"
3. **Track every patch** in `PATCHES.md` at repo root — PR number, description, commit hash
4. **Test after cherry-picking** — run the project's test suite before publishing
5. **Do not rebase or squash** cherry-picks — keep original commit hashes for traceability

## Workflows

### Cherry-picking a fix from an upstream PR

```bash
# 1. Find the PR branch and fetch it
git fetch upstream <pr-branch-name>

# 2. Identify the commit(s) to cherry-pick
git log --oneline upstream/<pr-branch-name>

# 3. Apply to current patched branch
git checkout patched/2026.4.5
git cherry-pick <commit-hash>

# 4. If conflict: resolve, then git cherry-pick --continue
# 5. Update PATCHES.md — add entry under "Active Patches"
# 6. Test: npm test (or whatever the project uses)
# 7. Push
git push origin patched/2026.4.5
```

### Publishing to npm

```bash
# Scope the package to avoid conflicts with upstream
# In package.json: "name": "@headclaw/openclaw"

npm version <new-version>   # e.g. 2026.4.5-patched.1
npm publish --access public
```

The version scheme is: `UPSTREAM_VERSION-patched.N` where N increments per patch.

### Upgrading to a new upstream release

```bash
# 1. Fetch latest tags
git fetch upstream --tags

# 2. Create new patched branch from new tag
git checkout -b patched/NEW_VERSION upstream/vNEW_VERSION

# 3. Review PATCHES.md — check which patches are still needed
#    Some may have been merged upstream; cherry-pick will tell you "already applied"

# 4. Re-apply active patches
git cherry-pick <hash1> <hash2> ...

# 5. Drop merged patches — move them to "Dropped" section in PATCHES.md
# 6. Test
# 7. Publish new version
npm version NEW_VERSION-patched.1
npm publish --access public

# 8. Update HeadClaw's .env: OPENCLAW_VERSION=NEW_VERSION-patched.1
# 9. Push branch
git push -u origin patched/NEW_VERSION
```

### Checking what patches are applied

```bash
# Show commits on patched branch that aren't in the upstream tag
git log --oneline v2026.4.5..patched/2026.4.5
```

## npm Publishing

- **Package name:** `@headclaw/openclaw` (scoped to avoid conflict with upstream `openclaw`)
- **Registry:** npmjs.com
- **Access:** public (required for scoped packages on free npm plan)
- Before first publish, update `package.json`:
  - `"name": "@headclaw/openclaw"`
  - Remove or update `"repository"` and `"homepage"` to point to this fork

## HeadClaw Integration

This package is installed on customer VPS machines by HeadClaw's provisioning system:
- **Bootstrap:** `scripts/vps-bootstrap.sh` runs `npm install -g @headclaw/openclaw@VERSION`
- **Updates:** `scripts/hq-controller.js` upgrades via `npm install -g @headclaw/openclaw@VERSION`
- **Version control:** `OPENCLAW_VERSION` in HeadClaw's `.env` controls what version all VPSes run
- **Update rollout:** `pnpm update:all` in HeadClaw triggers upgrades across all tenant VPSes

## Current State

- **Upstream version:** 2026.4.5
- **Current patched branch:** `patched/2026.4.5`
- **Active patches:** see `PATCHES.md`
