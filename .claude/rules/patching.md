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
2. **Track every patch** in `.claude/docs/PATCHES.md` — type (PR or custom), description, commit hash. Include the user-reported issue description (what the user actually observed and complained about) in the **Problem** section, not just the technical root cause.
3. **Docs in a standalone bookkeeping commit** — all `.claude/` content (PATCHES.md, changelog, rules) lives in a single commit at the tip of the patched branch, never baked into individual patch commits. This keeps patch commits clean for cherry-picking during version upgrades. When adding a new patch, amend or replace this bookkeeping commit. When upgrading to a new release, restore `.claude/` via `git checkout <old-patched-branch> -- .claude/` instead of cherry-picking the old bookkeeping commit.
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
#    When a bookkeeping commit already exists at the tip:
#      a. Soft-reset it: git reset --soft HEAD~1
#      b. Unstage .claude/ files: git reset HEAD .claude/
#      c. Commit the patch (code + test files only, no .claude/)
#      d. Update .claude/docs/PATCHES.md with the new patch entry
#      e. Re-stage and commit all .claude/ as a new bookkeeping commit:
#         git add -f .claude/ && git commit --no-verify -m "docs: bookkeeping — patches, changelog, rules"
#    If no bookkeeping commit exists yet, just create one after the patch commit.
#    NEVER amend .claude/ content into a patch commit — it makes cherry-picks dirty.
#    NEVER rebase to drop old bookkeeping commits — it loses other .claude/ files (changelogs, rules).
# 6. Test: npm test (or whatever the project uses)
# 7. Push
git push origin patched/2026.4.5
```

### Local pack + install (validate a build on one VPS before publishing)

Publishing to npm rolls a release to every tenant once HeadClaw's `OPENCLAW_VERSION` bumps. For a new patch you usually want to prove the fix works on one customer VPS *first*, then publish for real. The pack flow does exactly that: same build pipeline as the publish flow, written to a local tarball instead of pushed to npm.

```bash
# 1. Build the tarball locally (no npm login needed).
./.claude/scripts/pack-headclaw.sh 2026.5.7-patched.3
# → ./youchi1-openclaw-2026.5.7-patched.3.tgz

# 2. Copy to the test VPS.
scp youchi1-openclaw-2026.5.7-patched.3.tgz <vps>:/tmp/

# 3. Install from the tarball + restart the gateway service.
ssh <vps> 'npm install -g /tmp/youchi1-openclaw-2026.5.7-patched.3.tgz \
  && systemctl restart <openclaw-gateway-unit>'

# 4. Verify the fix on that VPS (reproduce the original bug scenario,
#    watch logs, check the affected behaviour).

# 5. Only after the test VPS confirms the fix:
./.claude/scripts/publish-headclaw.sh 2026.5.7-patched.3
#    Then bump HeadClaw's .env OPENCLAW_VERSION to 2026.5.7-patched.3 and run
#    `pnpm update:all` so every tenant picks it up.
```

Rules of thumb:

- **Always use the PROD label — never suffixes.** Pack, install, and eventually publish under the same `X.Y.Z-patched.N` label. No `-rc`, `-rcN`, `-test`, `-dev`, `-beta`, or any other suffix on test builds. Ever. The label you pack is the label you publish.
- **Pack flow does not bump anything in the repo.** No commit, no tag, no version-in-package-json change. The transient `package.json` mutation is restored by the script's `EXIT` trap.
- **Pack flow is not a release.** Do not skip the publish step once the test VPS is happy. Other tenants only get the fix when npm has the version and HeadClaw's `OPENCLAW_VERSION` is bumped.
- **Branch invariant still applies.** `pack-headclaw.sh` aborts unless the current branch is `patched/X.Y.Z` matching the version arg's base, same as publish.

**Why no suffixes — the `lastTouchedVersion` trap.** OpenClaw records the binary's own version into `meta.lastTouchedVersion` inside `~/.openclaw/openclaw.json` every time the gateway saves config. At startup, the binary compares its own VERSION constant against that field and refuses to run if the recorded version is semver-newer. Per-semver-§11, a prerelease identifier that is alphanumeric (e.g. `"2-rc1"`) is ALWAYS treated as higher than a purely numeric one (e.g. `"3"`). So a one-off test build labeled `2026.5.7-patched.2-rc1` poisons the VPS: every subsequent install of the unsuffixed `2026.5.7-patched.3` is refused as a "downgrade." Recovery requires editing `meta.lastTouchedVersion` by hand on each affected VPS. Avoid the whole class of problem by never using suffixes — pack with the same numeric label that will eventually publish.

### Publishing to npm

**Do NOT rename `package.json` name field in the repo.** The package name must stay `openclaw` for runtime resolution (templates, control UI assets, etc.) to work. The publish script handles the scope rename transiently.

```bash
./.claude/scripts/publish-headclaw.sh 2026.5.7-patched.1
```

The publish tooling lives under `.claude/scripts/` so it travels with every patched branch via the bookkeeping restore. Always run from the repo root of the patched branch you want to publish, in the same checkout — no worktree, no second clone. See the upgrade workflow below.

This script:

1. Asserts the current branch is `patched/X.Y.Z` matching the version arg's base (fails loudly if you try to publish 2026.5.7-patched.N from a 2026.4.12 checkout, etc.)
2. Verifies clean working tree
3. Temporarily sets `name` to `@youchi1/openclaw` and `version` to the given arg
4. Adds `.claude/scripts/postinstall-rename.mjs` to the `files` array
5. Appends the rename script to the existing `postinstall` chain (preserving upstream's `postinstall-bundled-plugins.mjs`)
6. Builds and publishes
7. Restores `package.json` and `pnpm-lock.yaml` via `git checkout` (trap on EXIT)

On the consumer machine after `npm install -g`:

1. Upstream's `postinstall-bundled-plugins.mjs` runs (installs extension deps like `@buape/carbon`)
2. `.claude/scripts/postinstall-rename.mjs` runs — rewrites `name` back to `"openclaw"` and removes itself from the postinstall chain

This ensures upstream runtime code (which resolves its own package root by `package.json` name) works correctly without patching any upstream source files.

The version scheme is: `UPSTREAM_VERSION-patched.N` where N increments per patch.

### Verifying whether an upstream release subsumes a patch

Before dropping any active patch during a version upgrade, you must prove the upstream
release actually fixes the original bug — not just that someone claims it does in a
changelog summary. Changelog prose is often misleading; the only authoritative signal
is code behavior on the target release.

**Order of rigor (use as many as needed):**

1. **Check linked issues/PRs** — every HC patch lists upstream issue numbers in
   `PATCHES.md`. Look at what PR closed them and read the actual diff:
   ```bash
   gh issue view <num> --repo openclaw/openclaw
   gh pr view <closing-pr> --repo openclaw/openclaw --json files,additions,deletions
   ```
   If the issue is still open → upstream definitely did not fix it.

2. **Diff our changed files against upstream** — for every file in the HC patch,
   compare the function we modified:
   ```bash
   git diff vOLD_VERSION vNEW_VERSION -- <file>
   ```
   Read each diff and ask: does the upstream change produce the same observable
   behavior our patch does? If the file was refactored, find the equivalent.

3. **Cherry-pick on top of upstream (the cheap empirical test):**
   ```bash
   git checkout -b probe/NEW_VERSION vNEW_VERSION
   git cherry-pick <hc-commit>
   ```
   Three outcomes:
   - *"empty commit"* — upstream already contains the exact change. Drop the patch.
   - *Clean apply* — upstream did not fix it. Keep the patch.
   - *Conflict* — upstream touched the same code differently. This is where
     partial fixes hide. Inspect the conflict before deciding.

4. **Run our regression tests against pristine upstream (gold standard):**
   ```bash
   git checkout vNEW_VERSION
   git checkout patched/OLD_VERSION -- <our patch test files>
   pnpm test <those files>
   ```
   Passing tests = upstream's source fixes the same behavior.
   Failing tests = upstream still has the bug, OR the test is bound to an API
   shape that upstream refactored (read the failure carefully — assertion
   failures and import errors mean different things).

5. **Write new verification tests that exercise the ORIGINAL bug scenario.** This
   is the most reliable check when the existing patch test is bound to old API
   shape. Write a small focused test that:
   - Sets up the exact bug reproducer (real fs, real api calls when possible)
   - Runs against pristine upstream
   - Passes only if upstream's solution covers our case

   Commit these as a separate small `test(HC): upstream-subsumption verification tests`
   commit *before* the bookkeeping commit. They serve as regression alarms if a
   future upstream change re-introduces the bug.

**Three result categories:**

| Verdict | Action |
|---|---|
| **Subsumed** — upstream's code observably fixes the bug | Drop the patch. Keep the verification test as a regression alarm. |
| **Partial** — upstream fixes some scenarios but not all | Keep the patch with reduced scope; document what was dropped vs kept inside the HC entry in `PATCHES.md`. |
| **Not fixed** — upstream still has the bug | Keep the patch as-is. The verification test will FAIL on pristine upstream and PASS on the patched branch — that's the signal you want. |

Never decide based on the changelog alone. The HeadClaw 2026.4.12 → 2026.5.7 upgrade
caught three subsumption cases (HC-002, HC-004, HC-008 part 2) and three "looks fixed
but isn't" cases (HC-001 still partial, HC-003 unrelated upstream fix, HC-006
different layer) — only the code-level verification distinguished them.

### Upgrading to a new upstream release

Do the entire upgrade in a single checkout — switch branches in place, do **not** spin up a `git worktree` or a second clone. Two co-existing checkouts on different patched branches is how publishes end up building from the wrong tree.

```bash
# 1. Fetch latest tags
git fetch upstream --tags

# 2. Create new patched branch from new tag (in this same checkout)
git checkout -b patched/NEW_VERSION upstream/vNEW_VERSION

# 3. Review PATCHES.md from the old branch — check which patches are still needed.
#    Run the verification flow above for every patch before you decide to drop one.

# 4. Re-apply active patches (cherry-pick only code commits, not the bookkeeping commit)
git cherry-pick <hash1> <hash2> ...

# 5. Restore .claude/ from the old patched branch (not cherry-pick — avoids conflicts).
#    This also restores .claude/scripts/publish-headclaw.sh and postinstall-rename.mjs
#    so the new branch can publish itself.
git checkout patched/OLD_VERSION -- .claude/

# 6. Commit upstream-subsumption verification tests (single small commit) before
#    bookkeeping. These guard against future regressions of the bugs we just
#    confirmed upstream had subsumed.

# 7. Update bookkeeping and commit:
#    - Update PATCHES.md: drop merged patches to "Dropped", update hashes for re-applied ones
#    - Update changelog, rules, current state as needed
#    - Commit all .claude/ content as a single commit at the tip
# 8. Test
# 9. Push branch
git push -u origin patched/NEW_VERSION

# 10. Publish new version (from this same checkout, on patched/NEW_VERSION).
#     The script asserts the current branch matches the version arg's base.
./.claude/scripts/publish-headclaw.sh NEW_VERSION-patched.1

# 11. Update HeadClaw's .env: OPENCLAW_VERSION=NEW_VERSION-patched.1
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
- **Script:** `./.claude/scripts/publish-headclaw.sh <version>` handles the transient rename
- **Branch invariant:** the script aborts unless the current branch is `patched/X.Y.Z` matching the version arg's base. This prevents publishing old source under a new version label
- **Never commit** a `package.json` name change — it breaks template/asset resolution at runtime
- **Postinstall rename:** `.claude/scripts/postinstall-rename.mjs` rewrites the name back to `openclaw` on consumer machines after install — the publish script adds it to the `files` array transiently so it ships in the tarball
- **Why not patch upstream code?** Upstream has multiple places that check `package.json` name (`CORE_PACKAGE_NAMES`, `control-ui-assets.ts`, etc.). The postinstall approach fixes it at the root without touching upstream source, so no patches to maintain across versions

## HeadClaw Integration

This package is installed on customer VPS machines by HeadClaw's provisioning system:

- **Bootstrap:** `scripts/vps-bootstrap.sh` runs `npm install -g @youchi1/openclaw@VERSION`
- **Updates:** `scripts/hq-controller.js` upgrades via `npm install -g @youchi1/openclaw@VERSION`
- **Version control:** `OPENCLAW_VERSION` in HeadClaw's `.env` controls what version all VPSes run
- **Update rollout:** `pnpm update:all` in HeadClaw triggers upgrades across all tenant VPSes

## Current State

- **Upstream version:** 2026.5.7
- **Current patched branch:** `patched/2026.5.7`
- **Active patches:** see `.claude/docs/PATCHES.md`
