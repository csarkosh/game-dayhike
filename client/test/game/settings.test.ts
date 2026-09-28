import { describe, it, expect, afterEach, vi } from "vitest";
import { CAUTION_LIVE, TIER_CHOICES, listOpen, renderSettings, settingsModel, type SettingsInput } from "../../src/game/settings.js";
import { autoPick } from "../../src/game/frameProbe.js";
import type { GpuSignals } from "../../src/game/gpuSignals.js";
import { renderLanding } from "../../src/game/landing.js";
import { landingModel } from "../../src/game/landingModel.js";
import type { TierChoice } from "../../src/game/tierChoice.js";
import { StandInElement, StandInOption, StandInSelect, asHtml, installStandInDom } from "./helpers/standInDom.js";

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

  it("on the pause screen, names the tier the hike is running on", () => {
    const v = settingsModel({ context: "pause", choice: "auto", auto: { tier: "medium", probePending: false }, running: "high", override: null, stored: true });
    expect(v.lines).toEqual(["Auto picks Medium on this computer.", "This hike is using High."]);
  });

  it("says a switch that failed, after the other lines", () => {
    const v = settingsModel({
      context: "pause", choice: "high", selectionTier: "high", auto: null, running: "medium", override: null, stored: false,
      error: "Could not switch; still using Medium.",
    });
    expect(v.lines).toEqual([
      "This hike is using Medium.",
      "This browser is not keeping settings, so this choice lasts until the page closes.",
      "Could not switch; still using Medium.",
    ]);
  });

  it("names the class's start tier where the probe is skipped because shaders compile on the page's thread", () => {
    // Firefox 156 on an Apple M4, and the page's own summary of Auto (`autoSummary` in main.ts).
    const firefox: GpuSignals = {
      renderer: "Apple M1, or similar", adapter: null, limits: null, adapterStatus: "none", parallelCompile: false,
      cores: 10, memoryGb: null, mobile: false, browser: 156,
    };
    const caption = (signals: GpuSignals) => {
      const pick = autoPick(signals, { record: null, pixels: 2_073_600, now: 1_790_000_000_000 });
      const auto = { tier: pick.tier, probePending: pick.probeFrom !== null, ceiling: pick.ceiling };
      return settingsModel({ context: "title", choice: "auto", auto, override: null, stored: true }).lines;
    };
    expect(caption(firefox)).toEqual(["Auto picks Medium on this computer."]);
    expect(caption({ ...firefox, parallelCompile: true })).toEqual(["Auto tests this computer when your next hike starts."]);
  });

  it("has no Apply on the title screen, where a choice is kept as it is picked", () => {
    expect(settingsModel({ context: "title", choice: "high", auto: null, override: null, stored: true }).apply).toBe(undefined);
  });

  it("on the pause screen, offers Apply only for a selection that changes the running tier", () => {
    const base = { context: "pause" as const, auto: { tier: "medium" as const, probePending: false }, running: "medium" as const, override: null, stored: true };
    expect(settingsModel({ ...base, choice: "low", selectionTier: "low" }).apply).toEqual({ label: "Apply", disabled: false });
    expect(settingsModel({ ...base, choice: "medium", selectionTier: "medium" }).apply).toEqual({ label: "Apply", disabled: true });
    expect(settingsModel({ ...base, choice: "auto", selectionTier: "medium" }).apply).toEqual({ label: "Apply", disabled: true });
    // Auto's pick moved under a running hike (the governor): Apply switches to it.
    expect(settingsModel({ ...base, choice: "auto", auto: { tier: "low", probePending: false }, selectionTier: "low" }).apply).toEqual({
      label: "Apply", disabled: false,
    });
    expect(settingsModel({ ...base, choice: "low", override: "high", selectionTier: "high" }).apply).toEqual({ label: "Apply", disabled: true });
    expect(settingsModel({ ...base, choice: "low" }).apply).toEqual({ label: "Apply", disabled: true });
  });

  it("while applying, reads Applying… and holds every control", () => {
    const v = settingsModel({ context: "pause", choice: "high", selectionTier: "high", auto: null, running: "medium", override: null, stored: true, applying: true });
    expect(v.apply).toEqual({ label: "Applying…", disabled: true });
    expect(v.back).toEqual({ label: "Back", disabled: true });
    expect(v.choices.every((c) => c.disabled)).toBe(true);
  });
});

describe("a choice above what this computer is recommended", () => {
  const auto = { tier: "medium" as const, probePending: false, ceiling: "medium" as const };

  it("is honoured, with one quiet line under the choices", () => {
    const high = settingsModel({ context: "title", choice: "high", auto, override: null, stored: true });
    expect(high.choices.find((c) => c.selected)!.choice).toBe("high");
    expect(high.caution).toBe("Higher than recommended for this computer.");
    const paused = settingsModel({ context: "pause", choice: "high", selectionTier: "high", auto, running: "medium", override: null, stored: true });
    expect(paused.caution).toBe("Higher than recommended for this computer.");
  });

  it("says nothing for Auto, for a tier within the recommendation, or before the signals are in", () => {
    for (const choice of ["auto", "medium", "low"] as const) {
      expect(settingsModel({ context: "title", choice, auto, override: null, stored: true }).caution).toBe(undefined);
    }
    expect(settingsModel({ context: "title", choice: "high", auto: null, override: null, stored: true }).caution).toBe(undefined);
    expect(settingsModel({ context: "title", choice: "high", auto: { tier: "high", probePending: false, ceiling: "high" }, override: null, stored: true }).caution).toBe(undefined);
  });

  it("measures against the low cap too", () => {
    const capped = { tier: "low" as const, probePending: false, ceiling: "low" as const };
    expect(settingsModel({ context: "title", choice: "medium", auto: capped, override: null, stored: true }).caution).toBe("Higher than recommended for this computer.");
  });
});

describe("the caution line's announcement", () => {
  it("is read out politely when it appears, without taking the reader from the choice just pressed", () => {
    expect(CAUTION_LIVE).toBe("polite");
  });
});

describe("a choice put back on Auto", () => {
  it("says so under Auto's line, on both screens, until the next choice", () => {
    const auto = { tier: "medium" as const, probePending: false };
    const notice = "High did not start on this computer, so Settings is back on Auto (Recommended).";
    expect(settingsModel({ context: "title", choice: "auto", auto, override: null, stored: true, notice }).lines).toEqual([
      "Auto picks Medium on this computer.",
      notice,
    ]);
    expect(settingsModel({ context: "pause", choice: "auto", selectionTier: "medium", auto, running: "medium", override: null, stored: true, notice }).lines)
      .toEqual(["Auto picks Medium on this computer.", notice, "This hike is using Medium."]);
  });
});

describe("the stand-in document these screens are tested against", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops the focus from a node taken out of the page, as a browser does", () => {
    const doc = installStandInDom();
    const box = doc.createElement("div");
    const control = doc.createElement("select");
    doc.body.append(box);
    box.append(control);
    control.focus();
    expect(doc.activeElement).toBe(control);
    box.replaceChildren();
    expect(doc.activeElement).toBe(doc.body);
  });

  it("fires nothing when a script sets a select's value, and input then change when a person picks", () => {
    const doc = installStandInDom();
    const select = doc.createElement("select") as StandInSelect;
    doc.body.append(select);
    for (const v of ["a", "b"]) {
      const option = doc.createElement("option") as StandInElement & { value: string };
      option.value = v;
      select.append(option);
    }
    const heard: string[] = [];
    select.addEventListener("input", () => heard.push("input"));
    select.addEventListener("change", () => heard.push("change"));
    select.value = "b";
    expect(select.value).toBe("b");
    expect(heard).toEqual([]);
    select.choose("a");
    expect(select.value).toBe("a");
    expect(heard).toEqual(["input", "change"]);
  });
});

describe("the stand-in document, where a browser is strict", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A select in the page with options `values`, and the events it fired. */
  function select(values: string[]) {
    const doc = installStandInDom();
    const el = doc.createElement("select") as StandInSelect;
    doc.body.append(el);
    for (const v of values) {
      const option = doc.createElement("option") as StandInOption;
      option.value = v;
      el.append(option);
    }
    const heard: string[] = [];
    el.addEventListener("input", () => heard.push("input"));
    el.addEventListener("change", () => heard.push("change"));
    return { doc, el, heard };
  }

  it("selects the first option as options go in, with nothing chosen yet", () => {
    const { el } = select(["a", "b"]);
    expect(el.selectedIndex).toBe(0);
    expect(el.options.map((o) => o.selected)).toEqual([true, false]);
  });

  it("fires nothing when a person picks the value already chosen", () => {
    const { el, heard } = select(["a", "b"]);
    el.value = "b";
    el.choose("b");
    expect(heard).toEqual([]);
  });

  it("never lets a person pick a disabled option", () => {
    const { el, heard } = select(["a", "b"]);
    el.options[1]!.disabled = true;
    el.choose("b");
    expect(el.value).toBe("a");
    expect(heard).toEqual([]);
  });

  it("selects nothing when a script sets a value no option has", () => {
    const { el } = select(["a", "b"]);
    el.value = "c";
    expect(el.selectedIndex).toBe(-1);
    expect(el.value).toBe("");
  });

  it("gives no focus to a node under a hidden or display: none ancestor", () => {
    const { doc, el } = select(["a"]);
    el.hidden = true;
    el.focus();
    expect(doc.activeElement).toBe(doc.body);
    el.hidden = false;
    doc.body.style.display = "none";
    el.focus();
    expect(doc.activeElement).toBe(doc.body);
  });

  it("takes the focus from a node that goes disabled, or goes under an inert ancestor", () => {
    const doc = installStandInDom();
    const box = doc.createElement("div");
    const button = doc.createElement("button");
    doc.body.append(box);
    box.append(button);
    button.focus();
    button.disabled = true;
    expect(doc.activeElement).toBe(doc.body);
    button.disabled = false;
    button.focus();
    box.inert = true;
    expect(doc.activeElement).toBe(doc.body);
  });

  it("delivers no click, by pointer or by key, to a node that cannot take the focus", () => {
    const doc = installStandInDom();
    const box = doc.createElement("div");
    const button = doc.createElement("button");
    doc.body.append(box);
    box.append(button);
    let clicks = 0;
    button.addEventListener("click", () => (clicks += 1));
    for (const hide of [() => (box.inert = true), () => (box.hidden = true), () => (box.style.display = "none")]) {
      hide();
      button.click();
      button.press();
      box.inert = false;
      box.hidden = false;
      box.style.display = "";
    }
    expect(clicks).toBe(0);
    button.click();
    expect(clicks).toBe(1);
  });

  it("takes the focus from a node whose ancestor is later set to display: none", () => {
    const doc = installStandInDom();
    const box = doc.createElement("div");
    const button = doc.createElement("button");
    doc.body.append(box);
    box.append(button);
    button.focus();
    box.style.display = "none";
    expect(doc.activeElement).toBe(doc.body);
  });

  it("selects the first option again when a script unselects the chosen one", () => {
    const { el } = select(["a", "b"]);
    el.value = "b";
    el.options[1]!.selected = false;
    expect(el.selectedIndex).toBe(0);
    expect(el.value).toBe("a");
  });

  it("focuses a button a pointer clicks, as Chrome and Firefox do", () => {
    const doc = installStandInDom();
    const button = doc.createElement("button");
    doc.body.append(button);
    button.click();
    expect(doc.activeElement).toBe(button);
  });
});

describe("the Graphics select", () => {
  afterEach(() => vi.unstubAllGlobals());

  const title = (over: Partial<SettingsInput> = {}): SettingsInput => ({ context: "title", choice: "auto", auto: null, override: null, stored: true, ...over });

  function mount(input: SettingsInput) {
    const doc = installStandInDom();
    const root = doc.createElement("div");
    doc.body.append(root);
    const chosen: TierChoice[] = [];
    const ui = renderSettings(asHtml(root), settingsModel(input), { onChoose: (c) => chosen.push(c), onBack: () => {} });
    const selects = root.querySelectorAll("select") as StandInSelect[];
    const select = selects[0]!;
    const caption = root.descendants().find((el) => el.classList.contains("caution"))!;
    return { doc, root, ui, chosen, selects, select, caption };
  }

  it("is one select, not a row of buttons, offering Auto (Recommended), High, Medium and Low in that order", () => {
    const { root, selects, select } = mount(title());
    expect(selects.length).toBe(1);
    expect(root.descendants().filter((el) => el.tagName === "BUTTON" && el.classList.contains("choice")).length).toBe(0);
    expect(select.options.map((o) => o.value)).toEqual(["auto", "high", "medium", "low"]);
    expect(select.options.map((o) => o.textContent)).toEqual(["Auto (Recommended)", "High", "Medium", "Low"]);
    expect(select.value).toBe("auto");
  });

  it("selects the model's choice, and follows it on a repaint", () => {
    const { ui, select } = mount(title({ choice: "medium" }));
    expect(select.value).toBe("medium");
    expect(select.options.map((o) => o.selected)).toEqual([false, false, true, false]);
    ui.setView(settingsModel(title({ choice: "low" })));
    expect(select.value).toBe("low");
  });

  it("hands a person's pick to onChoose exactly once, and a repaint that moves the selection not at all", () => {
    const { ui, select, chosen } = mount(title());
    select.choose("high");
    expect(chosen).toEqual(["high"]);
    ui.setView(settingsModel(title({ choice: "low" })));
    ui.setView(settingsModel(title({ choice: "medium" })));
    expect(chosen).toEqual(["high"]);
  });

  it("keeps the same select and options across a repaint, and the keyboard's focus on the select", () => {
    const { doc, root, ui, select } = mount(title());
    const options = [...select.options];
    select.focus();
    ui.setView(
      settingsModel(title({ choice: "high", auto: { tier: "medium", probePending: false, ceiling: "medium" }, stored: false })),
    );
    expect(root.querySelectorAll("select")).toEqual([select]);
    expect(select.options.length).toBe(4);
    select.options.forEach((o, i) => expect(o).toBe(options[i]));
    expect(select.isConnected).toBe(true);
    expect(doc.activeElement).toBe(select);
  });

  it("is held while a choice is applied, and freed after", () => {
    const pause = (applying: boolean): SettingsInput => ({
      context: "pause", choice: "high", selectionTier: "high", auto: null, running: "medium", override: null, stored: true, applying,
    });
    const { ui, select, chosen } = mount(pause(true));
    expect(select.disabled).toBe(true);
    select.choose("low");
    expect(chosen).toEqual([]);
    ui.setView(settingsModel(pause(false)));
    expect(select.disabled).toBe(false);
    select.choose("low");
    expect(chosen).toEqual(["low"]);
  });

  it("is named Graphics by a label for it, has an id and a name, and is described by the caption", () => {
    const { root, select, caption } = mount(title());
    const labels = root.querySelectorAll("label");
    expect(labels.length).toBe(1);
    expect(labels[0]!.textContent).toBe("Graphics");
    expect(select.id).toMatch(/^settings-graphics-\d+$/);
    expect(labels[0]!.htmlFor).toBe(select.id);
    expect(select.name).toBe("graphics");
    expect(select.hasAttribute("aria-label")).toBe(false);
    expect(caption.id).toMatch(/^settings-caution-\d+$/);
    expect(select.getAttribute("aria-describedby")).toBe(caption.id);
  });

  it("gives every copy of the screen its own id, so each label names its own select", () => {
    const first = mount(title()).select.id;
    const second = mount(title()).select.id;
    expect(first).not.toBe(second);
  });

  it("keeps the caption a polite live region, always in the page, empty when there is nothing to say", () => {
    const auto = { tier: "medium" as const, probePending: false, ceiling: "medium" as const };
    const { ui, caption } = mount(title({ auto }));
    expect(caption.getAttribute("aria-live")).toBe("polite");
    expect(caption.textContent).toBe("");
    expect(caption.isConnected).toBe(true);
    ui.setView(settingsModel(title({ auto, choice: "high" })));
    expect(caption.textContent).toBe("Higher than recommended for this computer.");
    ui.setView(settingsModel(title({ auto, choice: "medium" })));
    expect(caption.textContent).toBe("");
    expect(caption.isConnected).toBe(true);
    expect(caption.hidden).toBe(false);
  });
});

describe("the heading's focus ring", () => {
  afterEach(() => vi.unstubAllGlobals());

  // No browser applies these styles here, so this reads the screen's own
  // style text: the one rule that takes the heading's ring away must spare
  // keyboard focus, which a keyboard user reaching the screen by the
  // browser's Forward lands on.
  it("is taken away only where the focus is not keyboard focus", () => {
    const doc = installStandInDom();
    const root = doc.createElement("div");
    doc.body.append(root);
    const view = settingsModel({ context: "title", choice: "auto", auto: null, override: null, stored: true });
    renderSettings(asHtml(root), view, { onChoose: () => {}, onBack: () => {} });
    const css = root.querySelector("style")!.textContent.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]*h2[^{}]*)\{([^}]*)\}/g)].filter((m) => /outline:\s*none/.test(m[2]!));
    expect(rules.map((m) => m[1]!.trim())).toEqual(['.settings h2[tabindex="-1"]:focus:not(:focus-visible)']);
  });
});

describe("whether a select's list is showing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is what the browser says through :open, and no where it cannot say", () => {
    const doc = installStandInDom();
    const select = doc.createElement("select");
    expect(listOpen(null)).toBe(false);
    expect(listOpen(doc.window as unknown as EventTarget)).toBe(false);
    select.openState = true;
    expect(listOpen(select as unknown as EventTarget)).toBe(true);
    select.openState = false;
    expect(listOpen(select as unknown as EventTarget)).toBe(false);
    // A browser without :open throws on the selector: read as closed, so
    // Escape keeps its one meaning there.
    select.openState = "unsupported";
    expect(listOpen(select as unknown as EventTarget)).toBe(false);
  });
});

describe("the title screen's Settings panel", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The landing on its home panel, whose Settings button opens the panel
   * at once, as the route change does. */
  function landing() {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    doc.body.append(container);
    const kept: TierChoice[] = [];
    const noop = () => {};
    const view = landingModel({ desktop: false, host: "darwin-arm64", latest: null, quality: { choice: "medium", auto: null, override: null, stored: true } });
    const page = renderLanding(asHtml(container), view, {
      onCreate: noop, onJoin: noop, onDownloads: noop, onCredits: noop, onBack: noop,
      onSettings: () => page.setPanel("settings"),
      onChooseTier: (c) => kept.push(c),
    });
    const entry = container.descendants().find((el) => el.tagName === "BUTTON" && el.textContent === "Settings")!;
    const panel = container.descendants().find((el) => el.classList.contains("panel") && el.classList.contains("settings"))!;
    const select = panel.querySelector("select") as StandInSelect;
    const heading = panel.querySelector("h2")!;
    return { doc, page, entry, select, heading, kept };
  }

  it("takes the focus to the select when a key opened it, and keeps a pick at once", () => {
    const { doc, entry, select, kept } = landing();
    entry.press();
    expect(doc.activeElement).toBe(select);
    expect(select.value).toBe("medium");
    select.choose("low");
    expect(kept).toEqual(["low"]);
  });

  it("takes the focus to the heading when a pointer opened it, so no picker opens unasked", () => {
    const { doc, entry, heading } = landing();
    entry.click();
    expect(doc.activeElement).toBe(heading);
    expect((heading as unknown as { tabIndex: number }).tabIndex).toBe(-1);
  });

  it("takes the focus to the heading when no press on its button opened it (the browser's Forward)", () => {
    const { doc, page, entry, heading } = landing();
    entry.press();
    page.setPanel("home");
    page.setPanel("settings");
    expect(doc.activeElement).toBe(heading);
  });
});
