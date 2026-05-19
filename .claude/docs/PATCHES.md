# HeadClaw OpenClaw Patches

Patches applied on top of each upstream release tag. Two types:

- **Upstream PR cherry-picks** — fixes from unmerged PRs
- **Custom patches** — our own fixes/workarounds, committed directly

## Active Patches — Upstream PRs

<!-- Format: - PR #NNN - Short description — commit hash -->

(none yet)

## Active Patches — Custom

<!-- Format: - HC-NNN - Short description — commit hash -->
<!-- If you open a PR upstream for this fix, note it: "upstream PR #NNN pending" -->

- HC-001 - Fix stale skillsSnapshot on new skill install — `b757d31512` on 2026.5.7 (was `d5b1141408` on 2026.4.12, `19598d5fcb` on 2026.4.11, `54a83201f8` on 2026.4.5)
  - **Problem:** User-installed skills (`~/.openclaw/skills/`) never appear in existing agent
    sessions. `openclaw skills list` shows them as "ready", but the agent system prompt
    (`available_skills`) keeps serving a stale snapshot. Affects VPS gateways, cron agents,
    and any long-running session.
  - **Root cause (two bugs):**
    1. `agent-command.ts` (used by agent runner, cron, plugin SDK) never called
       `ensureSkillsWatcher()`. The file watcher that detects new `SKILL.md` files and bumps
       the snapshot version was only started on the auto-reply path (`session-updates.ts`).
       Without the watcher, `getSkillsSnapshotVersion()` always returned 0, so
       `shouldRefreshSnapshotForVersion(0, 0)` returned `false` and the snapshot was never rebuilt.
    2. `session-updates.ts` had a version-0 cold-start bug: when skills were installed while
       OpenClaw was not running, the watcher never fired and the version stayed at 0. On next
       startup, `shouldRefreshSnapshotForVersion(0, 0)` returned `false`, so the stale snapshot
       was reused even though the filesystem had new skills.
  - **Fix:**
    1. Added `ensureSkillsWatcher({ workspaceDir, config: cfg })` call to `agent-command.ts`
       before the snapshot version check, matching what `session-updates.ts` already does.
    2. In `session-updates.ts`, when `snapshotVersion === 0` and no cached snapshot exists (or
       cached version is also 0), bump the version via `bumpSkillsSnapshotVersion()` before the
       refresh check. This forces a one-time rebuild that picks up any skills installed offline.
  - **Files changed:**
    - `src/agents/agent-command.ts` — added import + `ensureSkillsWatcher` call
    - `src/auto-reply/reply/session-updates.ts` — added `bumpSkillsSnapshotVersion` import + version-0 bump logic
    - `src/auto-reply/reply/session-updates.test.ts` — 3 new tests (version-0 rebuild, non-zero skip, mid-session watcher refresh)
    - `src/agents/skills/refresh-state.test.ts` — new file, 7 unit tests for `shouldRefreshSnapshotForVersion` edge cases
  - **Upstream issues:** [#54209](https://github.com/openclaw/openclaw/issues/54209), [#44898](https://github.com/openclaw/openclaw/issues/44898)
  - **Related upstream PRs (not cherry-pickable, code diverged in v2026.4.5):**
    [#55007](https://github.com/openclaw/openclaw/pull/55007) (agent-command fix, already superseded in our version),
    [#54228](https://github.com/openclaw/openclaw/pull/54228) (session-updates fix, targets older code)
  - **Drop when:** upstream merges #55007 and #54228 (or equivalent) and we upgrade to that release

- HC-003 - Bust OpenAI prompt cache when system prompt changes — `0d32754ee0` on 2026.5.7 (was `b4907fa999` on 2026.4.12, `4db9b812a4` on 2026.4.11, `c9ee96e422` on 2026.4.5)
  - **Problem:** OpenAI Responses API uses `prompt_cache_key` to route cache lookups. OpenClaw
    set this to the bare session ID. When the system prompt changed mid-session (skills
    added/removed, soul.md edited, bootstrap files updated), the cache key stayed the same. OpenAI
    served the stale cached prefix (~98% cache hit) containing the old system prompt, so the LLM
    never saw the updated `<available_skills>` block.
  - **Root cause:** `buildOpenAIResponsesParams()` in `openai-transport-stream.ts` set
    `prompt_cache_key: options?.sessionId` — a static key per session. OpenAI's docs say the key
    is "combined with the prefix hash", implying automatic invalidation on content change.
    In practice, with GPT-5.4 and long conversations, the stale prefix was served despite the
    system prompt changing. Confirmed via `OPENCLAW_DUMP_PAYLOAD=1` debug instrumentation:
    `cacheRead: 21888` tokens out of `22174` total (98.7% hit) with the old system prompt.
  - **Fix:** Include a short SHA-256 hash of `context.systemPrompt` in the cache key:
    `${sessionId}:${sha256(systemPrompt).slice(0, 12)}`. When the system prompt changes, the hash
    changes, forcing a cache miss. When the prompt is stable (normal turns), the hash is stable
    and caching works normally. Confirmed: `cacheRead: 15360` on subsequent same-prompt turns.
  - **Scope:** This fixes cache busting for ALL system prompt changes — not just skills, but also
    `soul.md`, `HEARTBEAT.md`, bootstrap files, context files, hooks, and any other injected content.
  - **Files changed:**
    - `src/agents/openai-transport-stream.ts` — added `createHash` import, modified `prompt_cache_key` to include system prompt hash
  - **Upstream issues:** same root cause as HC-001/HC-002, but at the provider transport layer
  - **Note:** Anthropic transport is not affected — it uses `cache_control` breakpoints with
    stable/dynamic split via `OPENCLAW_CACHE_BOUNDARY`, not key-based caching
  - **Drop when:** OpenAI fixes prefix-hash invalidation for Responses API, or upstream adds
    equivalent cache-busting logic

- HC-005 - Suppress NO_REPLY garbage text from context pollution — `f02c6ee440` on 2026.5.7 (was `2aa2044883` on 2026.4.12, `56b32f109e` on 2026.4.11)
  - **Problem:** Models (especially GPT 5.4 via Codex) sometimes output `NO_REPLY` glued to
    garbage text from context pollution after processing multi-select button callbacks (e.g.
    onboarding flow). Examples: `NO_REPLY출장샵assistant to=functions.message`, `NO_REPLY♀♀♀♀ to=function`,
    `NO_REPLY 񟿿 to=fun`. This garbage was delivered to users as visible Telegram messages.
  - **Root cause (two bugs):**
    1. The `startsWithSilentToken` regex only matched `[\p{L}\p{N}]` (letters/numbers) after
       NO_REPLY, missing symbols (`♀`), combining marks (`ై`), and space-separated garbage.
    2. When the regex did match, `normalizeReplyPayload` stripped the NO_REPLY prefix and
       delivered the remaining garbage (e.g. `출장샵assistant...`) instead of suppressing the
       entire payload.
  - **Fix:**
    1. Broadened `startsWithSilentToken` regex to `\S` — any non-whitespace character after
       NO_REPLY means garbage, regardless of Unicode category.
    2. Changed `normalizeReplyPayload` and `agent-runner-execution.ts` to drop the entire
       payload (return null / skip) instead of stripping the prefix.
  - **Files changed:**
    - `src/auto-reply/tokens.ts` — broadened regex from `[\p{L}\p{N}]` to `\S`
    - `src/auto-reply/tokens.test.ts` — updated expectations for broader matching
    - `src/auto-reply/reply/normalize-reply.ts` — drop text instead of stripping prefix
    - `src/auto-reply/reply/reply-utils.test.ts` — new suppression tests (symbols, CJK, combining marks, punctuation, space-separated)
    - `src/auto-reply/reply/agent-runner-execution.ts` — return skip instead of stripping
    - `src/agents/command/attempt-execution.test.ts` — updated accumulator expectation
  - **Upstream issues:** [#25592](https://github.com/openclaw/openclaw/issues/25592), [#64976](https://github.com/openclaw/openclaw/issues/64976)
  - **Drop when:** upstream merges a fix for #25592 / #64976

- HC-006 - Prevent duplicate Telegram delivery when message tool sends to same chat — `e7fc8e7503` on 2026.5.7 (was `9881929629`; amended 2026-05-19 to also fix the `finalAssistantText` path; was `335595ffae` on 2026.4.12)
  - **Problem:** When the agent uses the `message` tool to send a message to the same Telegram
    chat the session is running in, the message is sometimes delivered twice — once by the tool
    (with buttons), and again as a plain text "assistant message" (without buttons). Intermittent.
  - **Root cause:** `resolveSilentReplyFallbackText()` in `handleMessageEnd` replaces the LLM's
    "NO_REPLY" text with the last messaging tool sent text. This replacement was intended for the
    assistant stream / control UI transcript, but the same `text` variable was also reused for
    two separate downstream paths:
    1. The block reply emission path. The replaced text bypassed `reply-delivery.ts`'s
       `isSilent` suppression (which would have caught "NO_REPLY") and entered the block reply
       delivery pipeline, causing a second Telegram API `sendMessage` call. The intermittent
       nature came from whether `lastBlockReplyText` was already set by streaming (which would
       skip the safety send) — when no text was streamed for that assistant message, the guard
       was inactive.
    2. `finalAssistantText` → `assistantTexts` → `buildEmbeddedRunPayloads` → final reply payload.
       The silent-token filter in `payloads.ts:477` (`isSilentReplyPayloadText(p.text, SILENT_REPLY_TOKEN)`)
       can only drop a literal "NO_REPLY" — once the fallback substituted the tool's content in,
       the filter saw real text and let the payload through, producing the same duplicate at the
       reply-payload layer instead of the block-reply layer.
  - **Fix:** Split the text into two variables: `text` (with fallback, for assistant stream/transcript)
    and `blockReplyText` (original raw text, for block reply emission AND for `finalAssistantText`).
    Both the block reply path and `finalAssistantText` (which feeds `assistantTexts` →
    `buildEmbeddedRunPayloads` → final reply payloads) now use the original "NO_REPLY" which
    flows through to `reply-delivery.ts`'s silent-token suppression and
    `isSilentReplyPayloadText` filtering, preventing the duplicate delivery through either path.
  - **2026-05-19 amend (commit `e7fc8e7503`, was `9881929629`):** The original 2026.5.7 port only
    changed the block reply path. The PATCHES.md description claimed both paths were fixed, but
    the actual diff missed `finalAssistantText = silentExpectedWithoutSentinel ? "" : text` on
    line 771. Reported as a duplicate-delivery regression on the cu tenant
    (the onboarding "Tap all that apply, then Done ✅" prompt). Amended to also feed
    `blockReplyText` into `finalAssistantText`, and added a TDD regression test
    (`HC-006 amend: finalizeAssistantTexts receives raw NO_REPLY (not fallback tool text)`)
    that asserts `finalizeAssistantTexts` is invoked with `NO_REPLY` rather than the tool's
    fallback content. Test fails red on the unfixed code with the exact tool text leaking into
    the payload path; passes green after the amend.
  - **Files changed:**
    - `src/agents/pi-embedded-subscribe.handlers.messages.ts` — split `text` / `blockReplyText`
    - `src/agents/pi-embedded-subscribe.handlers.messages.test.ts` — regression test
  - **Upstream issues:** [#69208](https://github.com/openclaw/openclaw/issues/69208) (umbrella),
    related: #65468, #58611, #49023
  - **Introduced by:** upstream commit `356ce7647f` ("fix (agents): suppress NO_REPLY final text
    when message tool already sent text")
  - **Drop when:** upstream fixes the block reply path in `handleMessageEnd` to not use the
    fallback-replaced text

- HC-007 - Accumulate multi-select button clicks and dispatch on Done — `b78767b1ca` on 2026.5.7 (was `f384a45cc9`; rebased 2026-05-19 after HC-006 amend; was `bba83ddb2c`; amended 2026-05-15 to drop a port-time `clearCallbackButtons()` call; was `d6acf3eda9` on 2026.4.12)
  - **Problem:** Telegram inline buttons with multi-select (user taps several options then "Done ✅")
    triggered a separate agent turn for each button click. Each click was dispatched via
    `processMessage` as a synthetic text message, causing N separate LLM calls for N button clicks.
    With 8 options selected, this meant 8 agent turns with NO_REPLY responses, taking excessive time.
  - **Root cause:** The `callback_query` handler in `bot-handlers.runtime.ts` dispatched every
    button click to `processMessage` unconditionally. The `collect` queue mode's debounce (1000ms)
    couldn't help because each turn completed faster than the next click arrived, the agent was
    idle when the next click came in, so it ran immediately instead of queuing.
  - **Fix:** Added a multi-select button accumulator (`multiselect-accumulator.ts`) that intercepts
    `callback_query` events before they reach `processMessage`. Detection: if the message's inline
    keyboard contains a button with text matching `/done\s*✅/i` (case insensitive), the message is
    treated as multi-select. Non-Done clicks toggle in an in-memory accumulator (keyed by
    `chatId:messageId`) and update the button visuals with ✅ prefixes. When "Done ✅" is clicked,
    all accumulated selections are merged into a single synthetic message and dispatched once.
    Each button message tracks selections independently, so multiple button messages can coexist.
    Failed dispatches restore the accumulator so the user can retry. Accumulators expire after 30min.
  - **Files changed:**
    - `extensions/telegram/src/multiselect-accumulator.ts` — new module: accumulator logic
    - `extensions/telegram/src/multiselect-accumulator.test.ts` — 18 unit tests
    - `extensions/telegram/src/bot-handlers.runtime.ts` — interception in callback_query handler
  - **2026-05-15 amend (commit `f384a45cc9`, was `bba83ddb2c`):** The original 5.7 port of this
    patch added a `try { await clearCallbackButtons(); } catch {}` block at the start of the
    Done-click dispatch path. Almost certainly picked up from the surrounding 5.7 callback
    handlers (e.g. the `pluginBindingApproval` branch a few lines down) during cherry-pick
    conflict resolution, since the 4.12 commit `d6acf3eda9` did not have it. Effect: when the
    user tapped "Done ✅", openclaw issued `editMessageReplyMarkup` with `inline_keyboard: []`
    before dispatching the synthetic message, so the entire keyboard (including the ✅
    selection marks) disappeared from chat history. The 4.12 contract was that the keyboard
    stayed visible after Done with the ✅ annotations intact. Amended the patch to drop the
    five-line block and added a code comment locking in the "do not clear" intent so future
    upgrades don't re-introduce it.
  - **Drop when:** upstream adds native multi-select button support for Telegram

- HC-008 - Fix cron concurrency bottleneck — defer runningAtMs, adaptive stuck detection, maintenance-before-collect — `715600c7b9` on 2026.5.7 (was `f17c36313e`; rebased 2026-05-19 after HC-006 amend; was `2b22d3b868`; rebased 2026-05-15 after HC-007 amend; was `1ef290ba39` on 2026.4.12)
  - **Scope on 2026.5.7:** Part 2 (Nested lane concurrency wiring) was dropped because upstream
    2026.4.27 introduced a dedicated `CommandLane.CronNested` and wires its concurrency via
    `applyGatewayLaneConcurrency`. Verified with `src/gateway/server-lanes.hc-cron-nested.test.ts`.
    Parts 1, 3, and 4 are still required.
  - **Problem:** Cron jobs with `maxConcurrentRuns=6` did not actually run concurrently.
    Three separate issues combined to create a serial bottleneck and stale "running" markers:
    1. `onTimer` set `runningAtMs` on ALL due jobs before workers started, making queued jobs
       appear "running" in the UI (`cron.list`) and blocking them from being re-collected.
    2. ~~`CommandLane.Nested` (used by cron isolated-agent runs via `resolveNestedAgentLane`)
       defaulted to `maxConcurrent=1` and was never configured by `applyGatewayLaneConcurrency`,
       serializing all cron LLM work regardless of `maxConcurrentRuns`.~~ — **SUBSUMED** by
       upstream 2026.4.27 `CommandLane.CronNested`.
    3. `STUCK_RUN_MS = 2 hours` was the only automatic recovery for stale `runningAtMs` markers.
       Jobs that typically run in 1-2 minutes stayed stuck for 2 hours before being cleared.
    4. `normalizeJobTickState` (stuck marker cleanup) only ran when zero due jobs were found,
       so stuck jobs were never cleaned up on timer ticks that had other due jobs.
  - **Root cause:**
    - `timer.ts`: Phase-1 persist marked all due jobs with `runningAtMs` upfront.
    - `jobs.ts`: flat `STUCK_RUN_MS = 2h` with no adaptive detection.
    - `timer.ts`: `recomputeNextRunsForMaintenance` only ran in the "zero due jobs" branch,
      not before `collectRunnableJobs`.
  - **Fix (parts 1, 3, 4 kept; part 2 dropped):**
    1. Only set `runningAtMs` on the first `concurrency` jobs (the ones that start immediately);
       deferred jobs get `runningAtMs` set when a worker picks them up in `runDueJob`.
    3. Adaptive stuck detection: `max(lastDurationMs × 3, 15 minutes)` when the job has run
       history; flat 2h fallback for jobs with no history. Combined with upstream's new
       `alreadyExecutedSlot` logic (clear stuck marker but skip immediate re-fire when the
       slot has not yet been executed; allow re-fire when it has).
    4. Run `recomputeNextRunsForMaintenance` before `collectRunnableJobs` on every timer tick
       so stuck markers are cleared before job collection.
  - **Files changed:**
    - `src/cron/service/timer.ts` — defer `runningAtMs` to worker pickup; run maintenance before collecting
    - `src/cron/service/jobs.ts` — adaptive stuck detection with `resolveStuckRunMs()` (merged with upstream's `alreadyExecutedSlot` branch)
    - `src/cron/service/timer.hc-cron-bottleneck.test.ts` — regression tests (rewritten on 2026.5.7 to drop the obsolete Nested-lane test and adjust the stuck-clear test for upstream's two-tick re-run semantics)
  - **Upstream issues:** [#65225](https://github.com/openclaw/openclaw/issues/65225),
    [#66828](https://github.com/openclaw/openclaw/issues/66828),
    [#54180](https://github.com/openclaw/openclaw/issues/54180)
  - **Related upstream PRs:**
    [#69240](https://github.com/openclaw/openclaw/pull/69240) (preserve cron lane for top-level dispatch),
    [#54314](https://github.com/openclaw/openclaw/pull/54314) (isolate cron nested lane concurrency — **landed** as `CronNested` in 2026.4.27),
    [#67098](https://github.com/openclaw/openclaw/pull/67098) (configurable nested lane concurrency)
  - **Drop when:** upstream merges adaptive `STUCK_RUN_MS` detection and deferred Phase-1 `runningAtMs` persistence.

- HC-009 - Validate runtime auth-profile snapshot mtimes against disk — `fe62c004c3` on 2026.5.7 (was `79e5c61889`; rebased 2026-05-19 after HC-006 amend; was `246dedeccd`; rebased 2026-05-15 after HC-007 amend)
  - **Problem:** Customer's gateway pre-skipped `anthropic` with "billing issue (skipping all
    models)" on every boss run. Banner stayed hidden because the HeadClaw controller checks the
    on-disk `auth-state.json`, which said active=true (no `disabledUntil`). Disk was clean,
    on-disk profile looked fine, yet every model call failed before any HTTP request was made.
    Only a gateway restart unblocked it.
  - **Root cause:** `resolveRuntimeAuthProfileStore` in `src/agents/auth-profiles/store.ts`
    returned the in-memory runtime snapshot unconditionally once populated, with no mtime
    check. Two ways the snapshot drifts from disk:
    1. A separate process (cron probe, CLI tool, controller-side write) calls
       `markAuthProfileUsed` → `updateAuthProfileStoreWithLock` → `saveAuthProfileStore`.
       That writer has no in-process snapshot, so `hasRuntimeAuthProfileStoreSnapshot()`
       returns false and only disk is updated. The gateway's snapshot for the main store
       stays frozen.
    2. Within the same process, `saveAuthProfileStore` only refreshes the runtime snapshot
       when one already exists for that exact `agentDir`. Writes for agent-scoped stores
       whose snapshot was never seeded leave the main snapshot untouched even when the on-
       disk data they reach through merges changes.
    Once stale, every read returns `disabledUntil` from the dead billing window. `model-fallback`'s
    `resolveProfilesUnavailableReason(...) === "billing"` short-circuit then returns a `skip`
    decision without ever calling the provider, so no fresh failure record is written and the
    disk state never gets a chance to update from a real 401/402. Stuck until restart.
  - **Fix:** Track per-snapshot disk mtimes (`auth-profiles.json` + `auth-state.json`) when
    setting/replacing the snapshot. On every read in `resolveRuntimeAuthProfileStore`,
    revalidate the recorded mtimes against the current disk mtimes; if they diverge, reload
    from disk via `loadAuthProfileStoreForAgent(agentDir, { readOnly: true })` and refresh
    the snapshot in place. Checks run for both the main store and the requested `agentDir`
    when they differ.
  - **Files changed:**
    - `src/agents/auth-profiles/runtime-snapshots.ts` — parallel mtimes map, captured on
      `set`/`replace`, cleared on `clear`. New `getRuntimeAuthProfileStoreSnapshotMtimes`
      and `AuthProfileSnapshotMtimes` exports.
    - `src/agents/auth-profiles/store.ts` — new `refreshRuntimeAuthProfileStoreSnapshotIfStale`
      helper invoked from `resolveRuntimeAuthProfileStore` for main + agent-scoped keys.
    - `src/agents/auth-profiles.runtime-snapshot-refresh.test.ts` — TDD regression test. Fails
      on pristine upstream with the exact `disabledUntil` desync; passes with the fix. Also
      proves the snapshot is preserved when disk mtime is stable.
  - **Verification:** Test was written first, failed red against unpatched code with the
    expected `{disabledReason: "billing", disabledUntil: …} → undefined` mismatch, then
    passed green after the fix. Full `src/agents/auth-profiles` suite: 170/170.
  - **Upstream:** Should be filed upstream — this is a generic OpenClaw cross-process
    consistency bug, not HeadClaw-specific. The contract violation (in-memory snapshot is
    treated as authoritative without disk validation) applies to any deployment where any
    other code path can write to the auth store while the gateway is live.
  - **Drop when:** upstream adds mtime-validated snapshot refresh (or removes the snapshot
    layer entirely in favor of the existing mtime-keyed `loadedAuthStoreCache`).

- HC-010 - Restore `params.buttons` reader for the Telegram message tool — `497463213e` on 2026.5.7 (was `76a8d12e9d`; rebased 2026-05-19 after HC-006 amend; was `5321c522c5`; rebased 2026-05-15 after HC-007 amend)
  - **Problem:** Customer's agent sent a Telegram message via the `message` tool with the
    `buttons` parameter populated (`[[{"text":"Yes I can see them","callback_data":"yes"}], …]`).
    The tool returned `{ok: true, messageId: "14"}` and the text was delivered, but no inline
    keyboard rendered in Telegram. Worked correctly on `patched/2026.4.12`, stopped working
    after the upgrade to `patched/2026.5.7`. The bootstrap "boss" docs
    (`/opt/bootstrap/boss/TOOLS.md`) explicitly instruct: *"Use `message` tool (action `send`,
    `buttons` param) for questions."*
  - **Root cause:** Upstream removed the `readTelegramButtons(params)` reader and the
    `buttons:` line from `resolveTelegramButtonsFromParams` in
    `extensions/telegram/src/action-runtime.ts` during the 2026.5.x
    `interactive` → `presentation` schema rename. The resolver now reads only
    `params.presentation` / legacy `params.interactive`. The `message`-tool schema in
    `src/agents/tools/message-tool.ts` no longer declares a top-level `buttons` field at
    all, so the agent's `buttons` value passes through typebox unchanged and lands in the
    action runtime where nothing reads it. The downstream `resolveTelegramInlineButtons` in
    `extensions/telegram/src/button-types.ts` still accepts a `buttons` arg (`params.buttons
    ?? buildTelegramInteractiveButtons(...)`), so the orphaned plumbing was right there —
    just nothing was passing it.
  - **Fix:** Re-add `readTelegramButtons` to `extensions/telegram/src/action-runtime.ts`
    (same shape as `patched/2026.4.12`) and re-wire `resolveTelegramButtonsFromParams` to
    pass `buttons: readTelegramButtons(params)` alongside the existing `interactive` /
    `presentation` paths. Also coerce a JSON-string `buttons` value via `JSON.parse` before
    the array check — some LLMs serialize tool-input arrays as JSON strings, and supporting
    both shapes matches how the agent on the affected VPS actually emits the call.
  - **Files changed:**
    - `extensions/telegram/src/action-runtime.ts` — restore `readTelegramButtons`,
      `coerceTelegramButtonsParam`, `TELEGRAM_BUTTON_STYLES`, `RawTelegramButton`; add
      `buttons:` line back to `resolveTelegramButtonsFromParams`; re-import
      `normalizeOptionalString` / `normalizeOptionalLowercaseString` from `text-runtime` and
      `fitsTelegramCallbackData` from `./approval-callback-data.js`.
    - `extensions/telegram/src/action-runtime.hc-buttons.test.ts` — 9 regression tests
      (raw array shape, JSON-string shape, style preservation, malformed JSON, non-array
      rejection, missing-field rejection, oversize callback_data rejection, absent param,
      presentation-still-works).
  - **Verification:** Tests written first. Against pristine `patched/2026.5.7` source
    (`readTelegramButtons` not exported, `buttons:` not wired): 8 of 9 fail with
    `readTelegramButtons is not a function` and the array-shape test fails with the
    `sendMessageTelegram` mock not receiving `buttons` in opts. After the source patch:
    9/9 pass. Full Telegram extension suite: 1607/1607.
  - **Upstream issue:** Should be filed upstream — this is a regression in the
    `interactive` → `presentation` rename. Either upstream should keep accepting the raw
    `buttons` row shape, or the rename should have rewritten downstream agent docs / tool
    descriptions to use `presentation`. The half-removed `resolveTelegramInlineButtons`
    signature (which still accepts `buttons`) is direct evidence the removal was incomplete.
  - **Drop when:** upstream restores `params.buttons` support in the action runtime, OR we
    rewrite all agent-side `/opt/bootstrap/boss/TOOLS.md` instructions and field calls to use
    `presentation: { blocks: [{ type: "buttons", buttons: [{ label, value }] }] }` and verify
    no other consumers rely on the raw shape.

## Dropped (subsumed by upstream or no longer needed)

- **HC-002** - Skill watcher chokidar v5 glob bug — dropped on 2026.5.7 upgrade.
  Was `a96f286fc0` on 2026.4.12 (`681f93fef9` on 2026.4.11, `a802027f21` on 2026.4.5).
  Subsumed by upstream's directory-watch + filter rewrite of `resolveWatchPaths` + new
  `shouldIgnoreSkillsWatchPath` predicate. Verified by
  `src/agents/skills/refresh.hc-runtime-detection.test.ts` — creates a SKILL.md after
  watcher start and observes the version bump (also covers unlink). Both runtime-add and
  runtime-remove scenarios pass on pristine upstream.

- **HC-004** - Bootstrap file cache staleness — dropped on 2026.5.7 upgrade.
  Was `61b38877b9` on 2026.4.12 (`c4a4b19ff5` on 2026.4.11, `fc7dc508c9` on 2026.4.5).
  Subsumed by upstream 2026.4.26's per-turn refresh via `loadWorkspaceBootstrapFiles` combined
  with a content cache keyed by `inode|dev|size|mtime` inside `workspace.ts`. Upstream's
  approach covers a superset of HC-004's files (also includes USER.md, IDENTITY.md, MEMORY.md,
  HEARTBEAT.md, BOOTSTRAP.md, TOOLS.md). Verified by
  `src/agents/bootstrap-cache.hc-disk-reload.test.ts` — 7 file types + newly-created file all
  surface to the next `getOrLoadBootstrapFiles` call.

- **HC-008 part 2 only** - Nested lane concurrency wiring — dropped on 2026.5.7 upgrade.
  Subsumed by upstream 2026.4.27's introduction of a dedicated `CommandLane.CronNested` that
  is wired in `applyGatewayLaneConcurrency` (cleaner than our generic `CommandLane.Nested`
  modification because it prevents cron concurrency from bleeding into subagent/A2A flows).
  Verified by `src/gateway/server-lanes.hc-cron-nested.test.ts`. Parts 1, 3, 4 of HC-008
  remain — see the active entry above.

## Verification tests

A separate commit (`test(HC): upstream-subsumption verification tests`) carries four
focused tests that prove the dropped patches' original bug scenarios are still addressed
by upstream code. They serve as regression alarms if a future upstream release re-introduces
those bugs:

- `src/agents/skills/refresh.hc-runtime-detection.test.ts` — HC-002 sanity
- `src/agents/openai-transport-stream.hc-cache-key.test.ts` — HC-003 alarm (FAILS against
  pristine upstream; PASSES with our HC-003 source patch)
- `src/agents/bootstrap-cache.hc-disk-reload.test.ts` — HC-004 sanity
- `src/gateway/server-lanes.hc-cron-nested.test.ts` — HC-008 part 2 sanity

Workflow for adding new ones: see `.claude/rules/patching.md` →
"Verifying whether an upstream release subsumes a patch".
