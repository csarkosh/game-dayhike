/**
 * The Settings screen: one component for the title screen's Settings panel
 * and the pause screen's. `settingsModel` decides everything as data, where
 * vitest reaches it; `renderSettings` paints the result with DOM calls and
 * `textContent` only, into whichever panel hosts it.
 *
 * The graphics choice is one native `<select>`, drawn in the look the game's
 * text inputs share (the landing's join field). Apply and Back are plain
 * `<button>`s, so they take the host's own rules (`.landing button`,
 * `.pausemenu button`) and the host's tokens. The one style literal here is
 * for what is the component's own: the label, the select and its list, and
 * the caption lines.
 */
import type { QualityTier } from "./quality.js";
import type { TierChoice } from "./tierChoice.js";

/** The choices, in the order the screen offers them: Auto first, and the default. */
export const TIER_CHOICES: readonly TierChoice[] = ["auto", "high", "medium", "low"];

const LABELS: Record<TierChoice, string> = { auto: "Auto (Recommended)", high: "High", medium: "Medium", low: "Low" };
const TIER_NAMES: Record<QualityTier, string> = { high: "High", medium: "Medium", low: "Low" };
const RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 };

/** The line under the select for a tier chosen above the recommendation. */
export const ABOVE_RECOMMENDED = "Higher than recommended for this computer.";
/** How that line is announced: politely, when it appears, so the reader stays
 * on the choice just made and hears the line after it. */
export const CAUTION_LIVE = "polite";

/** What Auto would pick on this machine, whether it will first test it, and
 * the most it recommends here, where known: what the frame measured once a
 * verdict holds, else the class's ceiling (or the low cap). */
export type AutoSummary = { tier: QualityTier; probePending: boolean; ceiling?: QualityTier };

export type SettingsInput = {
  context: "title" | "pause";
  /** The choice shown selected: the saved one on the title screen, the
   * selection not yet applied on the pause screen. */
  choice: TierChoice;
  /** Null until the GPU's signals are in. */
  auto: AutoSummary | null;
  /** Pause: the tier this hike is running on now. */
  running?: QualityTier;
  /** Pause: the tier the selection resolves to (`resolveTier`), against which
   * Apply has something to do. */
  selectionTier?: QualityTier;
  /** Pause: a choice is being applied. */
  applying?: boolean;
  /** Pause: the last switch failed, and says so, after every other line. */
  error?: string;
  /** The stored choice went back to Auto after its tier did not start: said
   * under Auto's line until the next choice. */
  notice?: string;
  /** `?tier=` in the address. */
  override: QualityTier | null;
  /** Whether the browser keeps the choice across pages. */
  stored: boolean;
};

export type SettingsView = {
  heading: string;
  group: string;
  choices: { choice: TierChoice; label: string; selected: boolean; disabled: boolean }[];
  /** A tier chosen above the highest Auto would take here: honoured, and said
   * so in one quiet line under the select. */
  caution?: string;
  lines: string[];
  /** Pause only: the title screen keeps a choice as it is picked. */
  apply?: { label: string; disabled: boolean };
  back: { label: string; disabled: boolean };
};

/**
 * The screen as data. The lines, each only when it applies and in this order:
 * the override; Auto's pick, or that Auto will test this machine at the next
 * hike; on the pause screen, the tier this hike runs on; that the browser is
 * not keeping settings; a switch that failed. Apply, on the pause screen only,
 * switches the running hike: it has something to do when the selection
 * resolves to another tier than the one running.
 */
export function settingsModel(input: SettingsInput): SettingsView {
  const applying = input.applying === true;
  const lines: string[] = [];
  if (input.override !== null) {
    lines.push(`The address sets ${TIER_NAMES[input.override]} (?tier=${input.override}), which overrides this setting.`);
  }
  if (input.auto !== null) {
    lines.push(
      input.auto.probePending
        ? "Auto tests this computer when your next hike starts."
        : `Auto picks ${TIER_NAMES[input.auto.tier]} on this computer.`,
    );
  }
  if (input.notice !== undefined) lines.push(input.notice);
  if (input.context === "pause" && input.running !== undefined) lines.push(`This hike is using ${TIER_NAMES[input.running]}.`);
  if (!input.stored) lines.push("This browser is not keeping settings, so this choice lasts until the page closes.");
  if (input.context === "pause" && input.error !== undefined) lines.push(input.error);

  const view: SettingsView = {
    heading: "Settings",
    group: "Graphics",
    choices: TIER_CHOICES.map((choice) => ({
      choice,
      label: LABELS[choice],
      selected: choice === input.choice,
      disabled: applying,
    })),
    lines,
    back: { label: "Back", disabled: applying },
  };
  const ceiling = input.auto?.ceiling;
  if (input.choice !== "auto" && ceiling !== undefined && RANK[input.choice] > RANK[ceiling]) view.caution = ABOVE_RECOMMENDED;
  if (input.context === "pause") {
    const changes = input.selectionTier !== undefined && input.selectionTier !== input.running;
    view.apply = {
      label: applying ? "Applying…" : "Apply",
      disabled: applying || input.override !== null || !changes,
    };
  }
  return view;
}

/**
 * Whether `target` is a drop-down whose list is showing, as far as the
 * browser says: through `:open`, where it knows the selector. A browser that
 * does not throws on it, and a native select says nothing else about its
 * list, so there the answer is no.
 */
export function listOpen(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (el === null || typeof el.matches !== "function") return false;
  try {
    return el.matches(":open");
  } catch {
    return false;
  }
}

let ids = 0;

const STYLE = `
  .settings .group {
    margin: 0; font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(255, 255, 255, 0.62);
  }
  /* The game's input look (the landing's join field), drawn by us rather than
     by the browser, with a caret of its own so it still reads as a drop-down:
     two triangles of the text's colour, clear of the label by the right
     padding. Sized to its longest option, never under the width of the
     buttons beneath it, never wider than the panel. */
  .settings select.choice {
    -webkit-appearance: none; appearance: none;
    box-sizing: border-box; min-width: 14rem; max-width: 100%;
    padding: 0.5rem 2.25rem 0.5rem 0.75rem; font: inherit; color: #fff;
    background-color: rgba(255, 255, 255, 0.08);
    background-image:
      linear-gradient(45deg, transparent 50%, currentColor 50%),
      linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position: right 1.05rem center, right 0.75rem center;
    background-size: 0.3rem 0.3rem; background-repeat: no-repeat;
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
    cursor: pointer;
    /* The open list is the browser's: dark, so it is not drawn light on a
       dark page, and each option carries its colours for a browser that
       paints them from the option. */
    color-scheme: dark;
  }
  .settings select.choice option { background-color: #16191c; color: #eaf1f1; }
  .settings select.choice option:disabled { color: rgba(234, 241, 241, 0.45); }
  /* The ring the buttons show, on the same keyboard focus. */
  .settings select.choice:focus-visible { outline: 2px solid var(--btn-edge-lit); outline-offset: 3px; }
  .settings select.choice:disabled {
    cursor: default; color: rgba(255, 255, 255, 0.45);
    background-color: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.12);
  }
  .settings .line {
    margin: 0; max-width: 32rem; text-align: center; font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.62);
  }
  .settings .caution { min-height: 1.3em; font-size: 0.8rem; color: rgba(255, 255, 255, 0.45); }
`;

/**
 * Paints `view` into `root`. Everything is built once and `setView` updates it
 * in place: the select and its four options keep their nodes, so the select
 * keeps the keyboard's focus across a repaint; only the lines below are
 * rebuilt. A pick is heard on `change` alone; the select's value set from the
 * view fires nothing, so a repaint never comes back as a choice.
 */
export function renderSettings(
  root: HTMLElement,
  view: SettingsView,
  handlers: { onChoose(choice: TierChoice): void; onBack(): void; onApply?(): void },
): { setView(view: SettingsView): void; dispose(): void } {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const heading = document.createElement("h2");
  heading.textContent = view.heading;
  const n = ++ids;
  const select = document.createElement("select");
  select.className = "choice";
  select.id = `settings-graphics-${n}`;
  select.name = "graphics";
  const options = new Map<TierChoice, HTMLOptionElement>();
  for (const c of view.choices) {
    const option = document.createElement("option");
    option.value = c.choice;
    options.set(c.choice, option);
    select.append(option);
  }
  select.addEventListener("change", () => {
    const choice = TIER_CHOICES.find((c) => c === select.value);
    if (choice !== undefined) handlers.onChoose(choice);
  });

  // The visible group name is the select's label, so it is its accessible name too.
  const group = document.createElement("label");
  group.className = "group";
  group.htmlFor = select.id;
  group.textContent = view.group;

  // A live region from the start, so the line is announced when it appears,
  // and described by the select it is about.
  const caution = document.createElement("p");
  caution.className = "line caution";
  caution.id = `settings-caution-${n}`;
  caution.setAttribute("aria-live", CAUTION_LIVE);
  select.setAttribute("aria-describedby", caution.id);

  const lines = document.createElement("div");
  lines.style.display = "contents";

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "apply";
  apply.addEventListener("click", () => handlers.onApply?.());

  const back = document.createElement("button");
  back.type = "button";
  back.className = "back";
  back.addEventListener("click", () => handlers.onBack());

  function paint(v: SettingsView): void {
    heading.textContent = v.heading;
    group.textContent = v.group;
    for (const c of v.choices) {
      const option = options.get(c.choice);
      if (option === undefined) continue;
      option.textContent = c.label;
      option.disabled = c.disabled;
    }
    // A script's write: it fires no `change`, so this is never heard as a pick.
    const selected = v.choices.find((c) => c.selected);
    if (selected !== undefined && select.value !== selected.choice) select.value = selected.choice;
    select.disabled = v.choices.every((c) => c.disabled);
    // Never hidden: a live region taken out of the page and put back with its
    // text is not reliably announced. Empty, it keeps its line, so the screen
    // does not jump when it fills.
    caution.textContent = v.caution ?? "";
    lines.replaceChildren(
      ...v.lines.map((text) => {
        const line = document.createElement("p");
        line.className = "line";
        line.textContent = text;
        return line;
      }),
    );
    apply.hidden = v.apply === undefined;
    if (v.apply !== undefined) {
      apply.textContent = v.apply.label;
      apply.disabled = v.apply.disabled;
    }
    back.textContent = v.back.label;
    back.disabled = v.back.disabled;
  }

  paint(view);
  root.append(style, heading, group, select, caution, lines, apply, back);

  return {
    setView: paint,
    dispose() {
      for (const node of [style, heading, group, select, caution, lines, apply, back]) node.remove();
    },
  };
}
