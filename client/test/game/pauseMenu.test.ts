import { describe, it, expect } from "vitest";
import { PAUSE_START, createPlayGate, pauseMenuModel, pauseStep, type PauseState } from "../../src/game/pauseMenu.js";

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
    expect(pauseStep(PAUSE_START, { kind: "settings", saved: "auto" }).effect).toEqual({ kind: "focus", target: "choice" });
    expect(pauseStep(PAUSE_START, { kind: "escape" })).toEqual({ state: PAUSE_START, effect: { kind: "resume" } });
  });

  it("discards a choice not applied, on Back and on Escape", () => {
    const chosen = pauseStep(opened(), { kind: "choose", choice: "low" });
    expect(chosen).toEqual({ state: { panel: "settings", selection: "low", applying: false }, effect: null });
    for (const leave of [{ kind: "back" }, { kind: "escape" }] as const) {
      expect(pauseStep(chosen.state, leave)).toEqual({ state: PAUSE_START, effect: { kind: "focus", target: "settings" } });
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
    // Apply goes disabled once its choice is saved, and a disabled button
    // loses focus: it goes to the choice just applied.
    expect(pauseStep(applying.state, { kind: "applied" })).toEqual({
      state: { panel: "settings", selection: "high", applying: false },
      effect: { kind: "focus", target: "choice" },
    });
  });

  it("opens on the main panel each time it is shown, with Resume focused", () => {
    expect(pauseStep(pauseStep(opened(), { kind: "choose", choice: "low" }).state, { kind: "show" })).toEqual({
      state: PAUSE_START,
      effect: { kind: "focus", target: "resume" },
    });
    expect(pauseStep(PAUSE_START, { kind: "show" })).toEqual({ state: PAUSE_START, effect: { kind: "focus", target: "resume" } });
  });

  it("ignores a choice or an Apply with the main panel showing", () => {
    expect(pauseStep(PAUSE_START, { kind: "choose", choice: "low" })).toEqual({ state: PAUSE_START, effect: null });
    expect(pauseStep(PAUSE_START, { kind: "apply" })).toEqual({ state: PAUSE_START, effect: null });
  });
});

describe("the play gate", () => {
  /** A page whose pointer lock, bar and match end are set by the test, and
   * what the gate did to it, in order. */
  function page(start: { engaged: boolean; barOpen?: boolean; ended?: boolean }) {
    const now = { engaged: start.engaged, barOpen: start.barOpen ?? false, ended: start.ended ?? false };
    const did: string[] = [];
    const gate = createPlayGate({
      engaged: () => now.engaged,
      barOpen: () => now.barOpen,
      ended: () => now.ended,
      showMenu: () => did.push("show menu"),
      hideMenu: () => did.push("hide menu"),
      setSuppressed: (on) => did.push(`suppressed ${on}`),
      paused: (on) => did.push(`paused ${on}`),
    });
    /** The pointer lock taken (true) or released (false), as the browser reports it. */
    const lock = (engaged: boolean): void => {
      now.engaged = engaged;
      gate.engagedChanged(engaged);
    };
    return { gate, did, lock, now };
  }

  it("shows the menu when the lock goes, and plays on when it comes back", () => {
    const { did, lock } = page({ engaged: true });
    lock(false);
    lock(true);
    expect(did).toEqual(["show menu", "suppressed true", "paused true", "hide menu", "suppressed false", "paused false"]);
  });

  it("leaves the bar in charge while it is open", () => {
    const { did, lock } = page({ engaged: true, barOpen: true });
    lock(false);
    expect(did).toEqual([]);
  });

  it("keeps the controls held after the match's end, whatever the lock does", () => {
    const { did, lock } = page({ engaged: false, ended: true });
    lock(true);
    expect(did).toEqual(["hide menu", "suppressed true", "paused false"]);
  });

  it("under a cover, shows no menu when Escape frees the pointer, and never hands the controls back", () => {
    const { gate, did, lock } = page({ engaged: true });
    gate.cover();
    expect(gate.covered).toBe(true);
    lock(false);
    lock(true);
    lock(false);
    expect(did).toEqual(["suppressed true"]);
  });

  it("on the lift, with the pointer free, shows the menu on Resume, once", () => {
    const { gate, did, lock } = page({ engaged: true });
    const lift = gate.cover();
    lock(false);
    lift();
    lift();
    expect(gate.covered).toBe(false);
    expect(did).toEqual(["suppressed true", "show menu", "suppressed true", "paused true"]);
  });

  it("on the lift, with the pointer still locked, plays on", () => {
    const { gate, did } = page({ engaged: true });
    gate.cover()();
    expect(did).toEqual(["suppressed true", "hide menu", "suppressed false", "paused false"]);
  });

  it("on the lift after the match ended under it, keeps the controls held", () => {
    const { gate, did, now } = page({ engaged: true });
    const lift = gate.cover();
    now.ended = true;
    lift();
    expect(did).toEqual(["suppressed true", "hide menu", "suppressed true", "paused false"]);
  });
});
