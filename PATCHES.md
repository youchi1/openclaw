# HeadClaw OpenClaw Patches

Cherry-picked fixes from unmerged upstream PRs, applied on top of each release tag.

## Workflow

### Adding a patch (mid-cycle)
```bash
git checkout patched/CURRENT_VERSION
git cherry-pick <commit-hash>      # from upstream PR branch
npm version prerelease              # bumps -patched.N
npm publish
# Update OPENCLAW_VERSION in headclaw/.env, run pnpm update:all
```

### Upgrading to new upstream release
```bash
git fetch upstream --tags
git checkout -b patched/NEW_VERSION upstream/vNEW_VERSION

# Re-apply active patches:
git cherry-pick <hash1> <hash2> ...

# Drop any that upstream merged (cherry-pick will say "already applied")
# Update this file: move merged patches to Dropped section

npm version NEW_VERSION-patched.1
npm publish
# Update OPENCLAW_VERSION in headclaw/.env, run pnpm update:all
```

### Rebasing patches helper
```bash
# List commits unique to current patched branch:
git log --oneline upstream/main..HEAD
```

## Active Patches
<!-- Add entries as: - PR #NNN - Short description — commit hash -->

(none yet — add patches with cherry-pick as needed)

## Dropped (merged upstream)

(none yet)
