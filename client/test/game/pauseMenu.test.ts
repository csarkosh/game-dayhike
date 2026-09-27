import { describe, it, expect, afterEach, vi } from "vitest";
import { PAUSE_START, createPauseMenu, createPlayGate, pauseMenuModel, pauseStep, type PauseState } from "../../src/game/pauseMenu.js";
import { settingsModel } from "../../src/game/settings.js";
import type { TierChoice } from "../../src/game/tierChoice.js";
import { StandInSelect, asHtml, installStandInDom } from "./helpers/standInDom.js";

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
    // loses focus: it goes to the Graphics select.
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
    const now = { engaged: start.engaged, barOpen: start.barOpen ?? false, menuOpen: false, ended: start.ended ?? false };
    const did: string[] = [];
    const gate = createPlayGate({
      engaged: () => now.engaged,
      barOpen: () => now.barOpen,
      menuOpen: () => now.menuOpen,
      ended: () => now.ended,
      showMenu: () => {
        now.menuOpen = true;
        did.push("show menu");
      },
      hideMenu: () => {
        now.menuOpen = false;
        did.push("hide menu");
      },
      setSuppressed: (on) => did.push(`suppressed ${on}`),
      paused: (on) => did.push(`paused ${on}`),
    });
    /** The pointer lock taken (true) or released (false), as the browser reports it. */
    const lock = (engaged: boolean): void => {
      now.engaged = engaged;
      gate.engagedChanged(engaged);
    };
    /** The command bar opened or closed. */
    const bar = (open: boolean): void => {
      now.barOpen = open;
      gate.barChanged(open);
    };
    return { gate, did, lock, bar, now };
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

  it("hides the menu under the bar, and hands the controls back when the bar closes", () => {
    const { did, lock, bar } = page({ engaged: true });
    lock(false);
    bar(true);
    bar(false);
    lock(true);
    expect(did).toEqual([
      "show menu", "suppressed true", "paused true",
      "hide menu", "suppressed true",
      "suppressed false",
      "hide menu", "suppressed false", "paused false",
    ]);
  });

  it("keeps the controls held when the bar closes after the match's end", () => {
    const { did, bar, lock } = page({ engaged: true, ended: true });
    bar(true);
    bar(false);
    lock(true);
    expect(did).toEqual(["hide menu", "suppressed true", "suppressed true", "hide menu", "suppressed true", "paused false"]);
  });

  it("holds the controls the moment the match ends", () => {
    const { gate, did, now } = page({ engaged: true });
    now.ended = true;
    gate.refresh();
    expect(did).toEqual(["suppressed true"]);
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

describe("the pause screen's Settings page", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The menu, open, on a hike running Medium with Auto picking Medium. */
  function opened() {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    doc.body.append(container);
    let saved: TierChoice = "auto";
    const applied: TierChoice[] = [];
    let resumed = 0;
    let finish = (): void => {};
    const menu = createPauseMenu(asHtml(container), {
      onResume: () => (resumed += 1),
      onExit: () => {},
      settings: {
        saved: () => saved,
        view: (selection, applying) =>
          settingsModel({
            context: "pause", choice: selection, selectionTier: selection === "auto" ? "medium" : selection,
            auto: { tier: "medium", probePending: false }, running: "medium", override: null, stored: true, applying,
          }),
        onApply: (choice) => {
          applied.push(choice);
          saved = choice;
          return new Promise<void>((resolve) => (finish = resolve));
        },
      },
    });
    menu.show();
    const button = (label: string) => container.querySelectorAll("button").find((b) => b.textContent === label)!;
    const select = container.querySelector("select") as StandInSelect;
    const root = container.descendants().find((el) => el.classList.contains("pausemenu"))!;
    const heading = container.querySelector("h2")!;
    const onSettings = (): boolean => root.classList.contains("show-settings");
    const escape = () => (doc.activeElement === doc.body ? doc.body : doc.activeElement).dispatch("keydown", { code: "Escape", key: "Escape" });
    return { doc, menu, select, heading, button, onSettings, escape, applied, resumed: () => resumed, finish: () => finish() };
  }

  it("opens on the saved choice with the select focused, when a key opened it", () => {
    const page = opened();
    page.button("Settings").press();
    expect(page.onSettings()).toBe(true);
    expect(page.select.value).toBe("auto");
    expect(page.doc.activeElement).toBe(page.select);
  });

  it("opens with the heading focused when a pointer opened it, so no picker opens unasked", () => {
    const page = opened();
    page.button("Settings").click();
    expect(page.onSettings()).toBe(true);
    expect(page.doc.activeElement).toBe(page.heading);
    expect((page.heading as unknown as { tabIndex: number }).tabIndex).toBe(-1);
  });

  it("only selects on a pick; Apply keeps it, and the focus returns to the select once it is applied", async () => {
    const page = opened();
    page.button("Settings").press();
    page.select.choose("low");
    expect(page.applied).toEqual([]);
    expect(page.select.value).toBe("low");
    expect(page.button("Apply").disabled).toBe(false);
    page.button("Apply").press();
    expect(page.applied).toEqual(["low"]);
    expect(page.select.disabled).toBe(true);
    // Apply had the focus, and went disabled with the rest: the focus is
    // nowhere until the choice is applied.
    expect(page.doc.activeElement).toBe(page.doc.body);
    page.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.select.disabled).toBe(false);
    expect(page.doc.activeElement).toBe(page.select);
  });

  it("returns the focus to the heading once applied, when a pointer pressed Apply", async () => {
    const page = opened();
    page.button("Settings").press();
    page.select.choose("low");
    page.button("Apply").click();
    expect(page.doc.activeElement).toBe(page.doc.body);
    page.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.doc.activeElement).toBe(page.heading);
  });

  it("goes back on Escape from the select with its list closed, discarding the pick, as from anywhere else", () => {
    for (const openState of [false, "unsupported"] as const) {
      const page = opened();
      page.button("Settings").press();
      page.select.choose("high");
      page.select.openState = openState;
      const key = page.escape();
      expect(key.defaultPrevented).toBe(true);
      expect(page.onSettings()).toBe(false);
      expect(page.doc.activeElement).toBe(page.button("Settings"));
      page.button("Settings").click();
      expect(page.select.value).toBe("auto");
      vi.unstubAllGlobals();
    }
  });

  it("leaves an Escape that closes the select's open list to the list, and goes back on the next", () => {
    const page = opened();
    page.button("Settings").press();
    page.select.openState = true;
    const first = page.escape();
    expect(first.defaultPrevented).toBe(false);
    expect(page.onSettings()).toBe(true);
    expect(page.doc.activeElement).toBe(page.select);
    page.select.openState = false;
    page.escape();
    expect(page.onSettings()).toBe(false);
  });

  it("still resumes on Escape from the main page", () => {
    const page = opened();
    page.escape();
    expect(page.resumed()).toBe(1);
  });
});
