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

- HC-001 - Fix stale skillsSnapshot on new skill install — `d5b1141408` (was `19598d5fcb` on 2026.4.11, `54a83201f8` on 2026.4.5)
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

- HC-002 - Fix skill watcher not detecting new/removed skills (chokidar v5 glob bug) — `a96f286fc0` (was `681f93fef9` on 2026.4.11, `a802027f21` on 2026.4.5)
  - **Problem:** The skills file watcher used chokidar glob patterns (`*/SKILL.md`) to watch for
    skill changes. Chokidar v5 resolves globs at startup and does not detect new subdirectories
    created after the watcher starts. This meant installing or removing skills at runtime was
    completely invisible to the watcher — no events fired, version never bumped, snapshot never
    rebuilt.
  - **Root cause:** Chokidar v5 behavior change — glob patterns are resolved once at watch start.
    New files in new subdirectories matching the glob are silently missed. Confirmed with a
    self-contained test: `chokidar.watch("dir/*/SKILL.md")` fires zero events when a new
    `dir/new-skill/SKILL.md` is created, while `chokidar.watch("dir", { depth: 1 })` correctly
    fires add/change/unlink events.
  - **Fix:** Changed `resolveWatchTargets()` in `src/agents/skills/refresh.ts` to return the
    skill root directories themselves instead of glob patterns. The watcher now uses `depth: 1`
    to limit traversal and filters for `SKILL.md` in the event handlers. Also removed
    `awaitWriteFinish` which could interfere with unlink event delivery.
  - **Files changed:**
    - `src/agents/skills/refresh.ts` — replaced glob-based watch targets with directory watching + SKILL.md filter
    - `src/agents/skills/refresh.test.ts` — updated watcher test to assert on directory targets and depth option
  - **Upstream issues:** same as HC-001 ([#54209](https://github.com/openclaw/openclaw/issues/54209), [#44898](https://github.com/openclaw/openclaw/issues/44898))
  - **Drop when:** upstream fixes the chokidar v5 glob watcher or switches to a different FS watcher

- HC-003 - Bust OpenAI prompt cache when system prompt changes — `b4907fa999` (was `4db9b812a4` on 2026.4.11, `c9ee96e422` on 2026.4.5)
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

- HC-004 - Invalidate bootstrap file cache when files change on disk — `61b38877b9` (was `c4a4b19ff5` on 2026.4.11, `fc7dc508c9` on 2026.4.5)
  - **Problem:** Workspace bootstrap files (`SOUL.md`, `USER.md`, `IDENTITY.md`, etc.) were cached
    in-memory per session key in `bootstrap-cache.ts` with no staleness check. Edits to these files
    were invisible to the gateway until the process restarted.
  - **Root cause:** `getOrLoadBootstrapFiles()` stored loaded files in a `Map<string, WorkspaceBootstrapFile[]>`
    and returned the cached version unconditionally on subsequent calls for the same session key.
  - **Fix:** Store file mtimes alongside cached entries via `fs.statSync`. Before returning cached
    files, check if any mtime changed or if a previously-missing file appeared. If stale, reload
    from disk. The `statSync` cost (~0.1ms for a handful of files) is negligible per LLM turn.
  - **Files changed:**
    - `src/agents/bootstrap-cache.ts` — added mtime tracking and staleness check
    - `src/agents/bootstrap-cache.test.ts` — added fs mock, 2 new tests (mtime change, missing file appears)
  - **Drop when:** upstream adds bootstrap file invalidation or a file watcher for workspace files

- HC-005 - Suppress NO_REPLY garbage text from context pollution — `2aa2044883` (was `56b32f109e` on 2026.4.11)
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

- HC-006 - Prevent duplicate Telegram delivery when message tool sends to same chat — `335595ffae`
  - **Problem:** When the agent uses the `message` tool to send a message to the same Telegram
    chat the session is running in, the message is sometimes delivered twice — once by the tool
    (with buttons), and again as a plain text "assistant message" (without buttons). Intermittent.
  - **Root cause:** `resolveSilentReplyFallbackText()` in `handleMessageEnd` replaces the LLM's
    "NO_REPLY" text with the last messaging tool sent text. This replacement was intended for the
    assistant stream / control UI transcript, but the same `text` variable was also used for the
    block reply emission path. The replaced text bypassed `reply-delivery.ts`'s `isSilent`
    suppression (which would have caught "NO_REPLY") and entered the block reply delivery pipeline,
    causing a second Telegram API `sendMessage` call with the same content. The intermittent nature
    came from whether `lastBlockReplyText` was already set by streaming (which would skip the
    safety send) — when no text was streamed for that assistant message, the guard was inactive.
  - **Fix:** Split the text into two variables: `text` (with fallback, for assistant stream/transcript)
    and `blockReplyText` (original raw text, for block reply and final reply payload emission).
    Both the block reply path and `finalAssistantText` (which feeds `assistantTexts` →
    `buildEmbeddedRunPayloads` → final reply payloads) now use the original "NO_REPLY" which
    flows through to `reply-delivery.ts`'s silent-token suppression and
    `isSilentReplyPayloadText` filtering, preventing the duplicate delivery through either path.
  - **Files changed:**
    - `src/agents/pi-embedded-subscribe.handlers.messages.ts` — split `text` / `blockReplyText`
    - `src/agents/pi-embedded-subscribe.handlers.messages.test.ts` — regression test
  - **Upstream issues:** [#69208](https://github.com/openclaw/openclaw/issues/69208) (umbrella),
    related: #65468, #58611, #49023
  - **Introduced by:** upstream commit `356ce7647f` ("fix (agents): suppress NO_REPLY final text
    when message tool already sent text")
  - **Drop when:** upstream fixes the block reply path in `handleMessageEnd` to not use the
    fallback-replaced text

- HC-007 - Accumulate multi-select button clicks and dispatch on Done — `d6acf3eda9`
  - **Problem:** Telegram inline buttons with multi-select (user taps several options then "Done ✅")
    triggered a separate agent turn for each button click. Each click was dispatched via
    `processMessage` as a synthetic text message, causing N separate LLM calls for N button clicks.
    With 8 options selected, this meant 8 agent turns with NO_REPLY responses, taking excessive time.
  - **Root cause:** The `callback_query` handler in `bot-handlers.runtime.ts` dispatched every
    button click to `processMessage` unconditionally. The `collect` queue mode's debounce (1000ms)
    couldn't help because each turn completed faster than the next click arrived — the agent was
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
  - **Drop when:** upstream adds native multi-select button support for Telegram

## Dropped (merged upstream or no longer needed)

(none yet)
