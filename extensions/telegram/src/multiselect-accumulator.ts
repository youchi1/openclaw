/**
 * Multi-select button accumulator for Telegram inline keyboards.
 *
 * When a message has a "Done ✅" button (case-insensitive text match),
 * non-Done clicks are accumulated locally instead of dispatching to the agent.
 * When "Done" is clicked, all accumulated selections are dispatched as a single
 * synthetic message, avoiding N separate agent turns for N button clicks.
 *
 * Each message (chatId:messageId) has its own independent accumulator.
 */

import type { InlineKeyboardButton, InlineKeyboardMarkup } from "@grammyjs/types";

const DONE_BUTTON_RE = /done\s*✅/i;
const SELECTED_PREFIX = "✅ ";
const ACCUMULATOR_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type AccumulatedSelection = {
  text: string;
  callbackData: string;
};

type AccumulatorEntry = {
  selections: Map<string, AccumulatedSelection>; // keyed by callback_data
  createdAt: number;
};

const accumulators = new Map<string, AccumulatorEntry>();

function buildKey(chatId: string | number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function pruneStale() {
  const now = Date.now();
  for (const [key, entry] of accumulators) {
    if (now - entry.createdAt > ACCUMULATOR_TTL_MS) {
      accumulators.delete(key);
    }
  }
}

/**
 * Check if an inline keyboard contains a "Done ✅" button.
 */
export function hasMultiselectDoneButton(replyMarkup: InlineKeyboardMarkup | undefined): boolean {
  if (!replyMarkup?.inline_keyboard) {
    return false;
  }
  return replyMarkup.inline_keyboard.some((row) =>
    row.some((button) => DONE_BUTTON_RE.test(button.text)),
  );
}

/**
 * Check if the clicked button IS the "Done ✅" button.
 */
export function isDoneButtonClick(buttonText: string): boolean {
  return DONE_BUTTON_RE.test(buttonText);
}

/**
 * Find the text of the button that was clicked (by callback_data).
 */
export function findClickedButtonText(
  replyMarkup: InlineKeyboardMarkup | undefined,
  callbackData: string,
): string | undefined {
  if (!replyMarkup?.inline_keyboard) {
    return undefined;
  }
  for (const row of replyMarkup.inline_keyboard) {
    for (const button of row) {
      if ("callback_data" in button && button.callback_data === callbackData) {
        return button.text;
      }
    }
  }
  return undefined;
}

/**
 * Toggle a selection in the accumulator.
 * Returns the updated selections set.
 */
export function toggleSelection(
  chatId: string | number,
  messageId: number,
  selection: AccumulatedSelection,
): Map<string, AccumulatedSelection> {
  pruneStale();
  const key = buildKey(chatId, messageId);
  let entry = accumulators.get(key);
  if (!entry) {
    entry = { selections: new Map(), createdAt: Date.now() };
    accumulators.set(key, entry);
  }
  if (entry.selections.has(selection.callbackData)) {
    entry.selections.delete(selection.callbackData);
  } else {
    entry.selections.set(selection.callbackData, selection);
  }
  return entry.selections;
}

/**
 * Get all accumulated selections for a message and clear the accumulator.
 * Returns null if no selections were accumulated.
 */
export function drainSelections(
  chatId: string | number,
  messageId: number,
): AccumulatedSelection[] | null {
  const key = buildKey(chatId, messageId);
  const entry = accumulators.get(key);
  if (!entry || entry.selections.size === 0) {
    accumulators.delete(key);
    return null;
  }
  const selections = Array.from(entry.selections.values());
  accumulators.delete(key);
  return selections;
}

/**
 * Restore selections into the accumulator (used when dispatch fails).
 */
export function restoreSelections(
  chatId: string | number,
  messageId: number,
  selections: AccumulatedSelection[],
) {
  const key = buildKey(chatId, messageId);
  const entry: AccumulatorEntry = {
    selections: new Map(selections.map((s) => [s.callbackData, s])),
    createdAt: Date.now(),
  };
  accumulators.set(key, entry);
}

/**
 * Check if a callback_data value is currently selected.
 */
export function isSelected(
  chatId: string | number,
  messageId: number,
  callbackData: string,
): boolean {
  const key = buildKey(chatId, messageId);
  const entry = accumulators.get(key);
  return entry?.selections.has(callbackData) ?? false;
}

/**
 * Rebuild the inline keyboard with ✅ prefixes on selected buttons.
 * Preserves the original button structure and Done button.
 */
export function buildUpdatedKeyboard(
  originalKeyboard: InlineKeyboardButton[][],
  selections: Map<string, AccumulatedSelection>,
): InlineKeyboardButton[][] {
  return originalKeyboard.map((row) =>
    row.map((button): InlineKeyboardButton => {
      if (DONE_BUTTON_RE.test(button.text)) {
        // Don't modify the Done button
        return button;
      }
      const buttonCallbackData = "callback_data" in button ? button.callback_data : undefined;
      const isCurrentlySelected = selections.has(buttonCallbackData ?? "");
      const cleanText = button.text.replace(/^✅\s*/, "");
      return {
        ...button,
        text: isCurrentlySelected ? `${SELECTED_PREFIX}${cleanText}` : cleanText,
      };
    }),
  );
}

/**
 * Build the synthetic message text from accumulated selections.
 * Each selection's callback_data is included, separated by newlines.
 */
export function buildMultiselectResultMessage(selections: AccumulatedSelection[]): string {
  return selections.map((s) => s.callbackData).join("\n");
}

/** Visible for testing. */
export const __testing = {
  clear() {
    accumulators.clear();
  },
  getAccumulators() {
    return accumulators;
  },
};
