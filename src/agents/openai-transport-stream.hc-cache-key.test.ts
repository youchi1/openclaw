/**
 * HC-003 regression: prompt_cache_key must bust when the system prompt changes.
 *
 * Original bug: OpenClaw set `prompt_cache_key` to the bare session id. When
 * the system prompt changed mid-session (skills installed/removed, soul.md
 * edited, bootstrap files updated), the cache key stayed identical and
 * OpenAI happily served the stale cached prefix containing the OLD system
 * prompt (verified at ~98% cache hit in production traces). The LLM then
 * acted on stale `<available_skills>`, stale identity, stale memory, etc.
 *
 * Upstream 2026.5.4 (#77431) addressed ONE cause of system-prompt churn by
 * keeping per-turn runtime context out of ordinary chat system prompts. That
 * reduces invalidation pressure but does NOT solve the underlying cache-key
 * collision: any genuine system-prompt change (skills, soul, identity,
 * bootstrap, hooks) still reuses the same key.
 *
 * This test demonstrates the gap. We call buildOpenAIResponsesParams twice
 * with the SAME sessionId but DIFFERENT systemPrompt content. If upstream
 * busts the cache key on prompt change, the keys will differ. If they don't,
 * the bug remains and HC-003 is still needed.
 */
import { describe, expect, it } from "vitest";

import type { Model } from "./model.js";
import { buildOpenAIResponsesParams } from "./openai-transport-stream.js";

const baseModel: Model<"openai-responses"> = {
  id: "gpt-5.4",
  name: "GPT-5.4",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 65_536,
};

function buildKey(systemPrompt: string): string | undefined {
  const params = buildOpenAIResponsesParams(
    baseModel,
    {
      systemPrompt,
      messages: [{ role: "user", content: "Hello", timestamp: 1 }],
      tools: [],
    } as never,
    {
      sessionId: "session-stable",
      cacheRetention: "long",
    },
  ) as { prompt_cache_key?: string };
  return params.prompt_cache_key;
}

describe("HC-003 prompt_cache_key invalidation on system-prompt change", () => {
  it("cache key changes when system prompt content changes", () => {
    const keyA = buildKey("You are agent A. Identity: alpha. Skills: read, write.");
    const keyB = buildKey("You are agent A. Identity: alpha. Skills: read, write, exec.");
    // Same sessionId, different system prompt => the cache key MUST differ,
    // otherwise OpenAI will serve a stale cached prefix that still has the
    // old skill list.
    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();
    expect(keyA).not.toBe(keyB);
  });

  it("cache key is stable when system prompt is unchanged across turns", () => {
    const systemPrompt = "You are agent A. Identity: alpha. Skills: read, write.";
    const keyA = buildKey(systemPrompt);
    const keyB = buildKey(systemPrompt);
    // Same sessionId AND same system prompt => the cache key MUST be stable,
    // so OpenAI's prompt cache reuses the prefix.
    expect(keyA).toBe(keyB);
    expect(keyA).toBeDefined();
  });
});
