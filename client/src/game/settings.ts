/**
 * The Settings screen: one component for the title screen's Settings panel
 * and the pause screen's. `settingsModel` decides everything as data, where
 * vitest reaches it; `renderSettings` paints the result with DOM calls and
 * `textContent` only, into whichever panel hosts it.
 *
 * Its buttons are plain `<button>`s, so they take the host's own rules
 * (`.landing button`, `.pausemenu button`) and the host's tokens. The one
 * style literal here is for what is the component's own: the row of choices,
 * the lit state of the chosen one, and the caption lines.
 */
import type { QualityTier } from "./quality.js";
import type { TierChoice } from "./tierChoice.js";

/** The choices, in the order the screen offers them: Auto first, and the default. */
export const TIER_CHOICES: readonly TierChoice[] = ["auto", "high", "medium", "low"];

const LABELS: Record<TierChoice, string> = { auto: "Auto (Recommended)", high: "High", medium: "Medium", low: "Low" };
const TIER_NAMES: Record<QualityTier, string> = { high: "High", medium: "Medium", low: "Low" };
const RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 };

/** The line under the choices for a tier chosen above the recommendation. */
export const ABOVE_RECOMMENDED = "Higher than recommended for this computer.";
/** How that line is announced: politely, when it appears, so the reader stays
 * on the choice just pressed and hears the line after it. */
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
  /** Pause: the tier this hike is running on. */
  running?: QualityTier;
  /** Pause: the saved choice, against which Apply has something to do. */
  saved?: TierChoice;
  /** Pause: a choice is being applied. */
  applying?: boolean;
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
   * so in one quiet line under the choices. */
  caution?: string;
  lines: string[];
  /** Pause only: the title screen keeps a choice as it is pressed. */
  apply?: { label: string; disabled: boolean };
  back: { label: string; disabled: boolean };
};

/**
 * The screen as data. The lines, each only when it applies and in this order:
 * the override; Auto's pick, or that Auto will test this machine at the next
 * hike; on the pause screen, the tier this hike runs on and when a change
 * applies; that the browser is not keeping settings.
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
  if (input.context === "pause") {
    if (input.running !== undefined) lines.push(`This hike is using ${TIER_NAMES[input.running]}.`);
    lines.push("Applies the next time you start a hike.");
  }
  if (!input.stored) lines.push("This browser is not keeping settings, so this choice lasts until the page closes.");

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
    const saved = input.saved ?? input.choice;
    view.apply = {
      label: applying ? "Applying…" : "Apply",
      disabled: applying || input.override !== null || input.choice === saved,
    };
  }
  return view;
}

let cautionIds = 0;

const STYLE = `
  .settings .group {
    margin: 0; font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(255, 255, 255, 0.62);
  }
  .settings .choices {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; max-width: 36rem;
  }
  .settings .choices button.choice { margin-top: 0; }
  /* The chosen one is lit as a pointer lights the others, and stays so. */
  .settings button.choice[aria-pressed="true"] {
    background-color: var(--btn-fill-lit); border-color: var(--btn-edge-lit);
  }
  .settings .line {
    margin: 0; max-width: 32rem; text-align: center; font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.62);
  }
  .settings .caution { min-height: 1.3em; font-size: 0.8rem; color: rgba(255, 255, 255, 0.45); }
`;

/**
 * Paints `view` into `root`. Everything is built once and `setView` updates it
 * in place: the four choices keep their nodes, so the one pressed keeps the
 * keyboard's focus and its new `aria-pressed` is announced on it; only the
 * lines below are rebuilt.
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
  const group = document.createElement("p");
  group.className = "group";
  group.textContent = view.group;

  const choices = document.createElement("div");
  choices.className = "choices";
  choices.setAttribute("role", "group");
  choices.setAttribute("aria-label", view.group);
  const buttons = new Map<TierChoice, HTMLButtonElement>();
  for (const c of view.choices) {
    const button = document.createElement("button");
    button.type = "button";
    // `secondary`: the landing's hollow slab, so the chosen one can be lit
    // against the others rather than every choice outshouting the page.
    button.className = "secondary choice";
    button.addEventListener("click", () => handlers.onChoose(c.choice));
    buttons.set(c.choice, button);
    choices.append(button);
  }

  // A live region from the start, so the line is announced when it appears,
  // and described by the choices it is about.
  const caution = document.createElement("p");
  caution.className = "line caution";
  caution.id = `settings-caution-${++cautionIds}`;
  caution.setAttribute("aria-live", CAUTION_LIVE);
  choices.setAttribute("aria-describedby", caution.id);

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
    choices.setAttribute("aria-label", v.group);
    for (const c of v.choices) {
      const button = buttons.get(c.choice);
      if (button === undefined) continue;
      button.textContent = c.label;
      button.setAttribute("aria-pressed", String(c.selected));
      button.disabled = c.disabled;
    }
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
  root.append(style, heading, group, choices, caution, lines, apply, back);

  return {
    setView: paint,
    dispose() {
      for (const node of [style, heading, group, choices, caution, lines, apply, back]) node.remove();
    },
  };
}
