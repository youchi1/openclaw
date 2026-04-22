import { describe, expect, it, beforeEach } from "vitest";
import {
  hasMultiselectDoneButton,
  isDoneButtonClick,
  findClickedButtonText,
  toggleSelection,
  drainSelections,
  restoreSelections,
  isSelected,
  buildUpdatedKeyboard,
  buildMultiselectResultMessage,
  __testing,
} from "./multiselect-accumulator.js";

beforeEach(() => {
  __testing.clear();
});

const makeKeyboard = (buttons: Array<Array<{ text: string; callback_data: string }>>) => ({
  inline_keyboard: buttons.map((row) => row.map((b) => ({ ...b }))),
});

const SAMPLE_KEYBOARD = makeKeyboard([
  [{ text: "Founder / CEO", callback_data: "role_founder" }],
  [{ text: "Creator", callback_data: "role_creator" }],
  [{ text: "Developer", callback_data: "role_developer" }],
  [{ text: "Done ✅", callback_data: "done" }],
]);

describe("hasMultiselectDoneButton", () => {
  it("returns true when Done ✅ button exists", () => {
    expect(hasMultiselectDoneButton(SAMPLE_KEYBOARD)).toBe(true);
  });

  it("is case insensitive", () => {
    expect(
      hasMultiselectDoneButton(makeKeyboard([[{ text: "DONE ✅", callback_data: "d" }]])),
    ).toBe(true);
    expect(hasMultiselectDoneButton(makeKeyboard([[{ text: "done✅", callback_data: "d" }]]))).toBe(
      true,
    );
  });

  it("returns false when no Done button", () => {
    const keyboard = makeKeyboard([
      [{ text: "Option A", callback_data: "a" }],
      [{ text: "Option B", callback_data: "b" }],
    ]);
    expect(hasMultiselectDoneButton(keyboard)).toBe(false);
  });

  it("returns false for undefined reply_markup", () => {
    expect(hasMultiselectDoneButton(undefined)).toBe(false);
  });
});

describe("isDoneButtonClick", () => {
  it("matches Done ✅ variants", () => {
    expect(isDoneButtonClick("Done ✅")).toBe(true);
    expect(isDoneButtonClick("done ✅")).toBe(true);
    expect(isDoneButtonClick("Done✅")).toBe(true);
    expect(isDoneButtonClick("DONE  ✅")).toBe(true);
  });

  it("rejects non-Done text", () => {
    expect(isDoneButtonClick("Founder / CEO")).toBe(false);
    expect(isDoneButtonClick("✅ Selected")).toBe(false);
  });
});

describe("findClickedButtonText", () => {
  it("finds button text by callback_data", () => {
    expect(findClickedButtonText(SAMPLE_KEYBOARD, "role_founder")).toBe("Founder / CEO");
    expect(findClickedButtonText(SAMPLE_KEYBOARD, "done")).toBe("Done ✅");
  });

  it("returns undefined for unknown callback_data", () => {
    expect(findClickedButtonText(SAMPLE_KEYBOARD, "unknown")).toBeUndefined();
  });
});

describe("toggleSelection", () => {
  it("adds selection on first click", () => {
    const selections = toggleSelection(123, 1, {
      text: "Founder / CEO",
      callbackData: "role_founder",
    });
    expect(selections.size).toBe(1);
    expect(selections.has("role_founder")).toBe(true);
  });

  it("removes selection on second click (toggle off)", () => {
    toggleSelection(123, 1, { text: "Founder / CEO", callbackData: "role_founder" });
    const selections = toggleSelection(123, 1, {
      text: "Founder / CEO",
      callbackData: "role_founder",
    });
    expect(selections.size).toBe(0);
  });

  it("tracks multiple selections independently", () => {
    toggleSelection(123, 1, { text: "Founder / CEO", callbackData: "role_founder" });
    toggleSelection(123, 1, { text: "Creator", callbackData: "role_creator" });
    expect(isSelected(123, 1, "role_founder")).toBe(true);
    expect(isSelected(123, 1, "role_creator")).toBe(true);
    expect(isSelected(123, 1, "role_developer")).toBe(false);
  });

  it("keeps separate accumulators per message", () => {
    toggleSelection(123, 1, { text: "Founder", callbackData: "role_founder" });
    toggleSelection(123, 2, { text: "Creator", callbackData: "role_creator" });
    expect(isSelected(123, 1, "role_founder")).toBe(true);
    expect(isSelected(123, 1, "role_creator")).toBe(false);
    expect(isSelected(123, 2, "role_creator")).toBe(true);
    expect(isSelected(123, 2, "role_founder")).toBe(false);
  });
});

describe("drainSelections", () => {
  it("returns accumulated selections and clears", () => {
    toggleSelection(123, 1, { text: "Founder", callbackData: "role_founder" });
    toggleSelection(123, 1, { text: "Creator", callbackData: "role_creator" });
    const drained = drainSelections(123, 1);
    expect(drained).toHaveLength(2);
    expect(drained!.map((s) => s.callbackData).toSorted()).toEqual([
      "role_creator",
      "role_founder",
    ]);
    // Accumulator is cleared
    expect(drainSelections(123, 1)).toBeNull();
  });

  it("returns null when nothing accumulated", () => {
    expect(drainSelections(123, 99)).toBeNull();
  });
});

describe("restoreSelections", () => {
  it("restores selections after failed dispatch", () => {
    const selections = [
      { text: "Founder", callbackData: "role_founder" },
      { text: "Creator", callbackData: "role_creator" },
    ];
    restoreSelections(123, 1, selections);
    expect(isSelected(123, 1, "role_founder")).toBe(true);
    expect(isSelected(123, 1, "role_creator")).toBe(true);
  });
});

describe("buildUpdatedKeyboard", () => {
  it("adds ✅ prefix to selected buttons", () => {
    const selections = new Map([
      ["role_founder", { text: "Founder / CEO", callbackData: "role_founder" }],
    ]);
    const updated = buildUpdatedKeyboard(SAMPLE_KEYBOARD.inline_keyboard, selections);
    expect(updated[0][0].text).toBe("✅ Founder / CEO");
    expect(updated[1][0].text).toBe("Creator");
    expect(updated[3][0].text).toBe("Done ✅"); // Done button unchanged
  });

  it("removes ✅ prefix from deselected buttons", () => {
    const keyboardWithSelected = makeKeyboard([
      [{ text: "✅ Founder / CEO", callback_data: "role_founder" }],
      [{ text: "Creator", callback_data: "role_creator" }],
      [{ text: "Done ✅", callback_data: "done" }],
    ]);
    // Founder deselected (not in selections), Creator now selected
    const selections = new Map([
      ["role_creator", { text: "Creator", callbackData: "role_creator" }],
    ]);
    const updated = buildUpdatedKeyboard(keyboardWithSelected.inline_keyboard, selections);
    expect(updated[0][0].text).toBe("Founder / CEO"); // ✅ removed
    expect(updated[1][0].text).toBe("✅ Creator");
  });
});

describe("buildMultiselectResultMessage", () => {
  it("joins callback_data values with newlines", () => {
    const result = buildMultiselectResultMessage([
      { text: "Founder", callbackData: "role_founder" },
      { text: "Creator", callbackData: "role_creator" },
    ]);
    expect(result).toBe("role_founder\nrole_creator");
  });
});
