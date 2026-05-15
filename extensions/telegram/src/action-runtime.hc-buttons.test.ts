import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { captureEnv } from "openclaw/plugin-sdk/test-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleTelegramAction,
  readTelegramButtons,
  telegramActionRuntime,
} from "./action-runtime.js";

// HC-010 regression: prove the top-level `buttons` param the boss-tier agent
// docs instruct (`message` tool, `buttons` param) still drives Telegram inline
// keyboards on this release. Upstream 2026.5.x dropped the params.buttons
// reader during the interactive→presentation rename; the result was a silent
// no-op (message text shipped, keyboard dropped). This test asserts both the
// raw-array shape and the JSON-string shape an LLM might serialize.

const originalTelegramActionRuntime = { ...telegramActionRuntime };
const sendMessageTelegram = vi.fn(async () => ({ messageId: "789", chatId: "123" }));

function telegramConfig(overrides?: Record<string, unknown>): OpenClawConfig {
  return {
    channels: { telegram: { botToken: "tok", ...overrides } },
  } as OpenClawConfig;
}

describe("HC-010 readTelegramButtons", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["TELEGRAM_BOT_TOKEN"]);
    Object.assign(telegramActionRuntime, originalTelegramActionRuntime, { sendMessageTelegram });
    sendMessageTelegram.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "tok";
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("renders inline keyboard from raw params.buttons rows", async () => {
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "1726156086",
        message: "Button test",
        buttons: [
          [{ text: "Yes I can see them", callback_data: "yes" }],
          [{ text: "No buttons visible", callback_data: "no" }],
        ],
      },
      telegramConfig(),
    );

    expect(sendMessageTelegram).toHaveBeenCalledWith(
      "1726156086",
      "Button test",
      expect.objectContaining({
        buttons: [
          [{ text: "Yes I can see them", callback_data: "yes" }],
          [{ text: "No buttons visible", callback_data: "no" }],
        ],
      }),
    );
  });

  it("parses a JSON-string buttons param (LLM tool-input serialization)", async () => {
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "1726156086",
        message: "Button test",
        buttons:
          '[[{"text":"Yes I can see them","callback_data":"yes"}],[{"text":"No buttons visible","callback_data":"no"}]]',
      },
      telegramConfig(),
    );

    expect(sendMessageTelegram).toHaveBeenCalledWith(
      "1726156086",
      "Button test",
      expect.objectContaining({
        buttons: [
          [{ text: "Yes I can see them", callback_data: "yes" }],
          [{ text: "No buttons visible", callback_data: "no" }],
        ],
      }),
    );
  });

  it("preserves style when supplied", async () => {
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "123",
        message: "pick",
        buttons: [[{ text: "Stop", callback_data: "stop", style: "danger" }]],
      },
      telegramConfig(),
    );

    expect(sendMessageTelegram).toHaveBeenCalledWith(
      "123",
      "pick",
      expect.objectContaining({
        buttons: [[{ text: "Stop", callback_data: "stop", style: "danger" }]],
      }),
    );
  });

  it("rejects a string that is not valid JSON", () => {
    expect(() => readTelegramButtons({ buttons: "not-json" })).toThrow(/malformed JSON string/);
  });

  it("rejects a non-array buttons value", () => {
    expect(() => readTelegramButtons({ buttons: { rows: [] } })).toThrow(
      /must be an array of button rows/,
    );
  });

  it("requires both text and callback_data on each button", () => {
    expect(() => readTelegramButtons({ buttons: [[{ text: "Only" }]] })).toThrow(
      /requires text and callback_data/,
    );
  });

  it("rejects callback_data longer than 64 bytes", () => {
    const tooLong = "x".repeat(65);
    expect(() =>
      readTelegramButtons({ buttons: [[{ text: "X", callback_data: tooLong }]] }),
    ).toThrow(/callback_data too long/);
  });

  it("returns undefined when params.buttons is absent", () => {
    expect(readTelegramButtons({})).toBeUndefined();
    expect(readTelegramButtons({ buttons: null })).toBeUndefined();
    expect(readTelegramButtons({ buttons: undefined })).toBeUndefined();
  });

  it("still resolves buttons from presentation when params.buttons is absent", async () => {
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "123",
        presentation: {
          blocks: [{ type: "buttons", buttons: [{ label: "Go", value: "go" }] }],
        },
      },
      telegramConfig({ capabilities: { inlineButtons: "all" } }),
    );

    expect(sendMessageTelegram).toHaveBeenCalledWith(
      "123",
      "- Go",
      expect.objectContaining({
        buttons: [[{ text: "Go", callback_data: "go" }]],
      }),
    );
  });
});
