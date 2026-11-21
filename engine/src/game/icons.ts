/**
 * The line icons the page's buttons and the HUD share, in the game's own
 * strokes: the headlamp's hand torch, the pause bars, the speaker and the
 * speaker struck through. Drawn with DOM APIs, never markup: nothing dynamic
 * goes in, but the rule is the same for every node the game builds.
 */
const SVG = "http://www.w3.org/2000/svg";

export type IconKind = "lamp" | "pause" | "sound" | "muted";

const PATHS: Readonly<Record<IconKind, readonly string[]>> = {
  // A hand torch, head up: the body, the shoulder where it narrows, and the lens.
  lamp: ["M8.5 3h7v3.2L13.5 9.5V21h-3V9.5L8.5 6.2z", "M8.5 6.2h7", "M12 12.5v3"],
  pause: ["M8.5 5.5v13", "M15.5 5.5v13"],
  // A speaker: the box, the cone, and two waves.
  sound: ["M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z", "M15 9.5a3.5 3.5 0 0 1 0 5", "M17.5 7a7 7 0 0 1 0 10"],
  // The speaker struck through.
  muted: ["M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z", "M15.5 9.5l5 5", "M20.5 9.5l-5 5"],
};

export function lineIcon(kind: IconKind): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-linecap", "round");
  for (const d of PATHS[kind]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    if (kind === "pause") path.setAttribute("stroke-width", "2.6");
    svg.append(path);
  }
  return svg;
}
