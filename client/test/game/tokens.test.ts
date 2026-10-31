import { describe, it, expect, afterEach, vi } from "vitest";
import { createHud } from "../../src/game/hud.js";
import { renderLanding } from "../../src/game/landing.js";
import { landingModel } from "../../src/game/landingModel.js";
import { TOKENS_PALETTE, TOKENS_PIXELS, TOKENS_URL } from "../../src/game/tokens.js";
import { StandInElement, asHtml, installStandInDom } from "./helpers/standInDom.js";

/** Every link on the page to the donate page's door. */
const doors = (root: StandInElement): StandInElement[] =>
  root.descendants().filter((el) => el.tagName === "A" && (el as unknown as { href?: string }).href === TOKENS_URL);

describe("the title screen's Buy me tokens line", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The title screen on its home panel, as main.ts mounts it. */
  function title() {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    doc.body.append(container);
    const noop = () => {};
    const view = landingModel({ desktop: false, host: "darwin-arm64", latest: null, quality: { choice: "auto", auto: null, override: null, stored: true } });
    const page = renderLanding(asHtml(container), view, {
      onCreate: noop, onJoin: noop, onDownloads: noop, onSettings: noop, onChooseTier: noop,
      onChooseMode: noop, onCredits: noop, onBack: noop,
    });
    return { doc, container, page };
  }

  it("is there once, opening the dayhike door in a new tab with the icon before the words", () => {
    const { doc, page } = title();
    const links = doors(doc.body);
    expect(links).toHaveLength(1);
    const link = links[0]! as unknown as { target: string; rel: string } & StandInElement;
    expect(link.classList.contains("tokens")).toBe(true);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener");
    expect(link.textContent).toBe("Buy me tokens");
    const [icon, words] = link.children;
    expect(icon?.tagName).toBe("SVG");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(words?.tagName).toBe("#TEXT");
    // One line a page, not one a panel: it sits beside the panels, so it
    // stays put while they slide, and a repaint does not add another.
    expect(link.parent?.classList.contains("landing")).toBe(true);
    page.setPanel("credits");
    page.setView(landingModel({ desktop: false, host: "darwin-arm64", latest: null, quality: { choice: "auto", auto: null, override: null, stored: true } }));
    expect(doors(doc.body)).toHaveLength(1);
  });

  it("draws the sprite from the pixel map, one crisp path a colour, in the icon's ten colours", () => {
    const { doc } = title();
    const icon = doors(doc.body)[0]!.querySelector("svg")!;
    expect(icon.getAttribute("viewBox")).toBe("0 0 32 22");
    expect(icon.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(TOKENS_PIXELS).toHaveLength(22);
    for (const row of TOKENS_PIXELS) expect(row).toHaveLength(32);
    expect(Object.values(TOKENS_PALETTE)).toEqual([
      "#6b1113", "#e5484d", "#b32d33", "#ff7a80", "#ffd6d8",
      "#7a5600", "#f0c040", "#c8962a", "#ffe08a", "#fff7d6",
    ]);
    const paths = icon.querySelectorAll("path");
    expect(paths.map((p) => p.getAttribute("fill"))).toEqual(Object.values(TOKENS_PALETTE));
    // Each path's runs cover exactly the pixels of its colour.
    const letters = Object.keys(TOKENS_PALETTE);
    paths.forEach((path, i) => {
      const covered = new Set<string>();
      for (const [, x, y, w] of (path.getAttribute("d") ?? "").matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
        for (let dx = 0; dx < Number(w); dx++) covered.add(`${Number(x) + dx},${y}`);
      }
      const want = new Set<string>();
      TOKENS_PIXELS.forEach((row, y) => [...row].forEach((c, x) => c === letters[i] && want.add(`${x},${y}`)));
      expect(covered).toEqual(want);
    });
  });

  it("leaves with the title screen: a hike's HUD carries none", () => {
    const { doc, container } = title();
    // The route change into a hike clears the container (main.ts) before the HUD is built.
    container.replaceChildren();
    const hud = createHud(asHtml(container), { onPause: () => {} });
    hud.setPause({ key: "Esc" });
    expect(doors(doc.body)).toHaveLength(0);
    expect(container.descendants().some((el) => el.classList.contains("tokens"))).toBe(false);
    hud.dispose();
  });
});
