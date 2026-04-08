import { describe, expect, it } from "vitest";
import { buildOpenAIResponsesParams } from "./openai-transport-stream.js";

describe("buildOpenAIResponsesParams prompt_cache_key", () => {
  const baseModel = {
    id: "gpt-5.4",
    api: "openai-responses",
    provider: "openai-codex",
    reasoning: false,
  } as never;

  const baseContext = {
    messages: [],
    tools: [],
  };

  it("includes system prompt hash in cache key when session and prompt are present", () => {
    const params = buildOpenAIResponsesParams(
      baseModel,
      { ...baseContext, systemPrompt: "You are a helpful assistant." },
      { sessionId: "session-123" } as never,
    );

    expect(params.prompt_cache_key).toMatch(/^session-123:[a-f0-9]{12}$/);
  });

  it("changes cache key when system prompt changes", () => {
    const params1 = buildOpenAIResponsesParams(
      baseModel,
      { ...baseContext, systemPrompt: "You are assistant v1. Skills: A, B" },
      { sessionId: "session-123" } as never,
    );
    const params2 = buildOpenAIResponsesParams(
      baseModel,
      { ...baseContext, systemPrompt: "You are assistant v1. Skills: A, B, C" },
      { sessionId: "session-123" } as never,
    );

    expect(params1.prompt_cache_key).not.toBe(params2.prompt_cache_key);
    // Both start with the same session ID
    expect(params1.prompt_cache_key).toMatch(/^session-123:/);
    expect(params2.prompt_cache_key).toMatch(/^session-123:/);
  });

  it("produces stable cache key for identical system prompts", () => {
    const prompt = "Stable system prompt with skills list";
    const params1 = buildOpenAIResponsesParams(
      baseModel,
      { ...baseContext, systemPrompt: prompt },
      { sessionId: "session-123" } as never,
    );
    const params2 = buildOpenAIResponsesParams(
      baseModel,
      { ...baseContext, systemPrompt: prompt },
      { sessionId: "session-123" } as never,
    );

    expect(params1.prompt_cache_key).toBe(params2.prompt_cache_key);
  });

  it("uses bare session ID when no system prompt", () => {
    const params = buildOpenAIResponsesParams(baseModel, { ...baseContext }, {
      sessionId: "session-123",
    } as never);

    expect(params.prompt_cache_key).toBe("session-123");
  });

  it("omits cache key when cacheRetention is none", () => {
    const params = buildOpenAIResponsesParams(
      baseModel,
      { ...baseContext, systemPrompt: "Some prompt" },
      { sessionId: "session-123", cacheRetention: "none" } as never,
    );

    expect(params.prompt_cache_key).toBeUndefined();
  });

  it("omits cache key when no session ID", () => {
    const params = buildOpenAIResponsesParams(
      baseModel,
      { ...baseContext, systemPrompt: "Some prompt" },
      {} as never,
    );

    expect(params.prompt_cache_key).toBeUndefined();
  });
});
