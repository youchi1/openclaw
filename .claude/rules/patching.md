# OpenClaw — HeadClaw Patched Fork

This is a **thin fork** of [openclaw/openclaw](https://github.com/openclaw/openclaw). We cherry-pick fixes from unmerged upstream PRs and commit our own patches, all applied on top of release tags.

## Purpose

HeadClaw installs OpenClaw on customer VPS machines via `npm install -g`. Upstream has thousands of unmerged PRs with real bug fixes. This fork lets us ship those fixes to customers while staying aligned with upstream releases.

## Repository Layout

- **`upstream` remote** — `openclaw/openclaw` (read-only, fetch tags/branches)
- **`origin` remote** — `youchi1/openclaw` (our fork, push here)
- **`main` branch** — synced with upstream main, do NOT commit here
- **`patched/X.Y.Z` branches** — release tag + cherry-picked fixes (this is where we work)

## Rules

1. **Keep the patch list small** — only add what HeadClaw actually needs, not "nice to haves"
2. **Track every patch** in `.claude/docs/PATCHES.md` — type (PR or custom), description, commit hash
3. **Docs in a standalone bookkeeping commit** — all `.claude/` content (PATCHES.md, changelog, rules) lives in a single commit at the tip of the patched branch, never baked into individual patch commits. This keeps patch commits clean for cherry-picking during version upgrades. When adding a new patch, amend or replace this bookkeeping commit.
4. **Test after patching** — run the project's test suite before publishing
5. **Do not rebase or squash** cherry-picks — keep original commit hashes for traceability
6. **Custom patches should be upstreamed when possible** — open a PR upstream, note it in .claude/docs/PATCHES.md

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
# 5. Update the bookkeeping commit at branch tip:
#    - Amend or replace the .claude/ commit with updated PATCHES.md
#    - If no bookkeeping commit exists yet, create one
# 6. Test: npm test (or whatever the project uses)
# 7. Push
git push origin patched/2026.4.5
```

### Publishing to npm

**Do NOT rename `package.json` name field in the repo.** The package name must stay `openclaw` for runtime resolution (templates, control UI assets, etc.) to work. The publish script handles the scope rename transiently.

```bash
./scripts/publish-headclaw.sh 2026.4.5-patched.1
```

This script:

1. Verifies clean working tree
2. Temporarily sets `name` to `@youchi1/openclaw` and `version` to the given arg
3. Adds `scripts/postinstall-rename.mjs` to the `files` array
4. Appends the rename script to the existing `postinstall` chain (preserving upstream's `postinstall-bundled-plugins.mjs`)
5. Builds and publishes
6. Restores `package.json` and `pnpm-lock.yaml` via `git checkout` (trap on EXIT)

On the consumer machine after `npm install -g`:

1. Upstream's `postinstall-bundled-plugins.mjs` runs (installs extension deps like `@buape/carbon`)
2. `postinstall-rename.mjs` runs — rewrites `name` back to `"openclaw"` and removes itself from the postinstall chain

This ensures upstream runtime code (which resolves its own package root by `package.json` name) works correctly without patching any upstream source files.

The version scheme is: `UPSTREAM_VERSION-patched.N` where N increments per patch.

### Upgrading to a new upstream release

```bash
# 1. Fetch latest tags
git fetch upstream --tags

# 2. Create new patched branch from new tag
git checkout -b patched/NEW_VERSION upstream/vNEW_VERSION

# 3. Review PATCHES.md from the old branch — check which patches are still needed
#    Some may have been merged upstream; cherry-pick will tell you "already applied"

# 4. Re-apply active patches (skip the old bookkeeping commit — it's .claude/ only)
git cherry-pick <hash1> <hash2> ...

# 5. Write a fresh bookkeeping commit:
#    - Update PATCHES.md: drop merged patches to "Dropped", update hashes for re-applied ones
#    - Update changelog if needed
#    - Commit all .claude/ content as a single commit at the tip
# 6. Test
# 7. Push branch
git push -u origin patched/NEW_VERSION

# 8. Publish new version
./scripts/publish-headclaw.sh NEW_VERSION-patched.1

# 9. Update HeadClaw's .env: OPENCLAW_VERSION=NEW_VERSION-patched.1
```

### Checking what patches are applied

```bash
# Show commits on patched branch that aren't in the upstream tag
git log --oneline v2026.4.5..patched/2026.4.5
```

## npm Publishing

- **Package name at publish time:** `@youchi1/openclaw` (scoped to avoid conflict with upstream)
- **Package name in repo:** `openclaw` (must stay unchanged for runtime resolution to work)
- **Registry:** npmjs.com
- **Access:** public (required for scoped packages on free npm plan)
- **Script:** `./scripts/publish-headclaw.sh <version>` handles the transient rename
- **Never commit** a `package.json` name change — it breaks template/asset resolution at runtime
- **Postinstall rename:** `scripts/postinstall-rename.mjs` rewrites the name back to `openclaw` on consumer machines after install — this file lives in the repo but is only included in the published tarball by the publish script
- **Why not patch upstream code?** Upstream has multiple places that check `package.json` name (`CORE_PACKAGE_NAMES`, `control-ui-assets.ts`, etc.). The postinstall approach fixes it at the root without touching upstream source, so no patches to maintain across versions

## HeadClaw Integration

This package is installed on customer VPS machines by HeadClaw's provisioning system:

- **Bootstrap:** `scripts/vps-bootstrap.sh` runs `npm install -g @youchi1/openclaw@VERSION`
- **Updates:** `scripts/hq-controller.js` upgrades via `npm install -g @youchi1/openclaw@VERSION`
- **Version control:** `OPENCLAW_VERSION` in HeadClaw's `.env` controls what version all VPSes run
- **Update rollout:** `pnpm update:all` in HeadClaw triggers upgrades across all tenant VPSes

## Current State

- **Upstream version:** 2026.4.11
- **Current patched branch:** `patched/2026.4.11`
- **Active patches:** see `.claude/docs/PATCHES.md`
