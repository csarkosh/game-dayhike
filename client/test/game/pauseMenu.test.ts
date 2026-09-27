import { describe, it, expect } from "vitest";
import { PAUSE_START, pauseMenuModel, pauseStep, type PauseState } from "../../src/game/pauseMenu.js";

describe("pauseMenuModel", () => {
  it("offers Resume, Settings and Exit, in that order", () => {
    expect(pauseMenuModel()).toEqual({
      title: "Paused",
      buttons: [
        { id: "resume", label: "Resume" },
        { id: "settings", label: "Settings" },
        { id: "exit", label: "Exit" },
      ],
    });
  });
});

describe("pauseStep", () => {
  const opened = (): PauseState => pauseStep(PAUSE_START, { kind: "settings", saved: "auto" }).state;

  it("opens Settings on the saved choice, and Escape on the main panel resumes", () => {
    expect(PAUSE_START).toEqual({ panel: "main", selection: null, applying: false });
    expect(opened()).toEqual({ panel: "settings", selection: "auto", applying: false });
    expect(pauseStep(PAUSE_START, { kind: "escape" })).toEqual({ state: PAUSE_START, effect: { kind: "resume" } });
  });

  it("discards a choice not applied, on Back and on Escape", () => {
    const chosen = pauseStep(opened(), { kind: "choose", choice: "low" });
    expect(chosen).toEqual({ state: { panel: "settings", selection: "low", applying: false }, effect: null });
    for (const leave of [{ kind: "back" }, { kind: "escape" }] as const) {
      expect(pauseStep(chosen.state, leave)).toEqual({ state: PAUSE_START, effect: null });
    }
    const reopened = pauseStep(pauseStep(chosen.state, { kind: "back" }).state, { kind: "settings", saved: "auto" }).state;
    expect(reopened.selection).toBe("auto");
  });

  it("applies the selection, and holds Back, Escape and the choices until it is done", () => {
    const chosen = pauseStep(opened(), { kind: "choose", choice: "high" }).state;
    const applying = pauseStep(chosen, { kind: "apply" });
    expect(applying).toEqual({ state: { panel: "settings", selection: "high", applying: true }, effect: { kind: "apply", choice: "high" } });
    for (const event of [{ kind: "back" }, { kind: "escape" }, { kind: "choose", choice: "low" }, { kind: "apply" }, { kind: "show" }] as const) {
      expect(pauseStep(applying.state, event)).toEqual({ state: applying.state, effect: null });
    }
    expect(pauseStep(applying.state, { kind: "applied" })).toEqual({
      state: { panel: "settings", selection: "high", applying: false },
      effect: null,
    });
  });

  it("opens on the main panel each time it is shown", () => {
    expect(pauseStep(pauseStep(opened(), { kind: "choose", choice: "low" }).state, { kind: "show" })).toEqual({ state: PAUSE_START, effect: null });
  });

  it("ignores a choice or an Apply with the main panel showing", () => {
    expect(pauseStep(PAUSE_START, { kind: "choose", choice: "low" })).toEqual({ state: PAUSE_START, effect: null });
    expect(pauseStep(PAUSE_START, { kind: "apply" })).toEqual({ state: PAUSE_START, effect: null });
  });
});
