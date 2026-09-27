import { describe, it, expect } from "vitest";
import { TIER_CHOICES, settingsModel } from "../../src/game/settings.js";

const CHOICES = (selected: string) => [
  { choice: "auto", label: "Auto (Recommended)", selected: selected === "auto", disabled: false },
  { choice: "high", label: "High", selected: selected === "high", disabled: false },
  { choice: "medium", label: "Medium", selected: selected === "medium", disabled: false },
  { choice: "low", label: "Low", selected: selected === "low", disabled: false },
];

describe("settingsModel", () => {
  it("offers Auto first, then High, Medium and Low, and names what Auto picked", () => {
    expect(TIER_CHOICES).toEqual(["auto", "high", "medium", "low"]);
    expect(
      settingsModel({ context: "title", choice: "auto", auto: { tier: "medium", probePending: false }, override: null, stored: true }),
    ).toEqual({
      heading: "Settings",
      group: "Graphics",
      choices: CHOICES("auto"),
      lines: ["Auto picks Medium on this computer."],
      back: { label: "Back", disabled: false },
    });
  });

  it("says when Auto will test the machine, and says nothing of Auto before the signals land", () => {
    const pending = settingsModel({ context: "title", choice: "high", auto: { tier: "medium", probePending: true }, override: null, stored: true });
    expect(pending.choices).toEqual(CHOICES("high"));
    expect(pending.lines).toEqual(["Auto tests this computer when your next hike starts."]);
    expect(settingsModel({ context: "title", choice: "auto", auto: null, override: null, stored: true }).lines).toEqual([]);
  });

  it("puts the override first and the storage line last", () => {
    const v = settingsModel({ context: "title", choice: "low", auto: { tier: "high", probePending: false }, override: "high", stored: false });
    expect(v.lines).toEqual([
      "The address sets High (?tier=high), which overrides this setting.",
      "Auto picks High on this computer.",
      "This browser is not keeping settings, so this choice lasts until the page closes.",
    ]);
  });

  it("on the pause screen, names the running tier and when a change applies", () => {
    const v = settingsModel({ context: "pause", choice: "auto", auto: { tier: "medium", probePending: false }, running: "high", override: null, stored: true });
    expect(v.lines).toEqual([
      "Auto picks Medium on this computer.",
      "This hike is using High.",
      "Applies the next time you start a hike.",
    ]);
  });

  it("has no Apply on the title screen, where a choice is kept as it is pressed", () => {
    expect(settingsModel({ context: "title", choice: "high", auto: null, override: null, stored: true }).apply).toBe(undefined);
  });

  it("on the pause screen, offers Apply only for a selection that differs from the saved choice", () => {
    const base = { context: "pause" as const, auto: null, running: "medium" as const, override: null, stored: true };
    expect(settingsModel({ ...base, choice: "high", saved: "auto" }).apply).toEqual({ label: "Apply", disabled: false });
    expect(settingsModel({ ...base, choice: "auto", saved: "auto" }).apply).toEqual({ label: "Apply", disabled: true });
    expect(settingsModel({ ...base, choice: "high", saved: "auto", override: "low" }).apply).toEqual({ label: "Apply", disabled: true });
  });

  it("while applying, reads Applying… and holds every control", () => {
    const v = settingsModel({ context: "pause", choice: "high", saved: "auto", auto: null, running: "medium", override: null, stored: true, applying: true });
    expect(v.apply).toEqual({ label: "Applying…", disabled: true });
    expect(v.back).toEqual({ label: "Back", disabled: true });
    expect(v.choices.every((c) => c.disabled)).toBe(true);
  });
});
