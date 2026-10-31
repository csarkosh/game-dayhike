/**
 * The title screen's "Buy me tokens" line: the donate page's address and its
 * icon, a shaded pixel heart with a gold token tucked at its lower right on a
 * 32 by 22 grid. The pixel map and the ten colours are copied from the
 * csarko.sh repository's `donate/icon.mjs`, the icon's one source, and drawn
 * the way it draws them: one `<path>` a colour, each run of that colour in a
 * row a one-pixel-tall rectangle in its `d`, with crisp edges. Built with DOM
 * APIs, never markup, as every node the game builds is.
 */
const SVG = "http://www.w3.org/2000/svg";

/** Where the line goes: the donate page's door for this game. */
export const TOKENS_URL = "https://donate.csarko.sh/dayhike";

/** Each letter in `PIXELS` is one pixel in one of these; a dot is transparent. */
export const TOKENS_PALETTE: Readonly<Record<string, string>> = {
  O: "#6b1113", // heart outline
  m: "#e5484d", // heart mid-tone
  s: "#b32d33", // heart shadow
  h: "#ff7a80", // heart highlight
  H: "#ffd6d8", // heart top highlight
  g: "#7a5600", // token outline
  G: "#f0c040", // token mid-tone
  c: "#c8962a", // token shadow
  l: "#ffe08a", // token highlight
  L: "#fff7d6", // token top highlight
};

// prettier-ignore
export const TOKENS_PIXELS: readonly string[] = [
  "................................",
  "........OOOO........OOOO........",
  ".......OmmmsO......OmmmsO.......",
  "......OhhmmmsO....OhhmmmsO......",
  ".....OhHHhmmmsO..OhHHhmmmsO.....",
  ".....OmhhmmmmmsOOmhhmmmmmsO.....",
  "....OmmmmmmmmmmmmmmmmmmmmssO....",
  "....OmmmmmmmmmmmmmmmmmmmmssO....",
  ".....OmmmmmmmmmmmmmmmmmmssO.....",
  ".....OmmmmmmmmmmmmmmmmmmssO.....",
  ".....Ommmmmmmmmmmmmmmmgggggg....",
  "......OmmmmmmmmmmmmmmgLlllllg...",
  ".......OmmmmmmmmmmmmgLGccccGGg..",
  "........OmmmmmmmmmmglGcGGGGlGcg.",
  ".........OmmmmmmmmsglcGGGGGGlcg.",
  "..........OmmmmmmssglcGGGGGGlcg.",
  "...........OmmmmsssglcGGGGGGlcg.",
  "............OmmssssglGcGGGGlGcg.",
  ".............OmsssO.gGGllllGcg..",
  "..............OssO...gccccccg...",
  "...............OO.....gggggg....",
  "................................",
];

/** Each colour's runs as one path's `d`, in the palette's order. */
function shapes(): { fill: string; d: string }[] {
  const runs: Record<string, string> = {};
  TOKENS_PIXELS.forEach((row, y) => {
    for (const run of row.matchAll(/([^.])\1*/g)) {
      const w = run[0].length;
      const letter = run[1]!;
      runs[letter] = `${runs[letter] ?? ""}M${run.index} ${y}h${w}v1h-${w}z`;
    }
  });
  return Object.keys(TOKENS_PALETTE)
    .filter((letter) => runs[letter] !== undefined)
    .map((letter) => ({ fill: TOKENS_PALETTE[letter]!, d: runs[letter]! }));
}

/** The icon, decorative: the words beside it say what the link is. */
export function tokensIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 32 22");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "tokens-icon");
  for (const { fill, d } of shapes()) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("fill", fill);
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The line itself: the icon and the words, once, opening the donate page in a new tab. */
export function tokensLink(): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "tokens";
  link.href = TOKENS_URL;
  link.target = "_blank";
  link.rel = "noopener";
  link.append(tokensIcon(), "Buy me tokens");
  return link;
}
