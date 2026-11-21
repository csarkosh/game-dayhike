/**
 * A flat map of where players are: the whole Earth in the Equal Earth projection (Natural Earth's
 * land and borders at 1:110m, from `world-atlas`, drawn with `d3-geo`), Antarctica left off, one
 * mark a city where its visitors came from, as wide as the square root of its visits is of the
 * most any city had, the part that reached a game filled in the accent and the rest a faded ring.
 * Nothing to turn or drag (Cyrus, 2026-11-21: a globe was too hard to get around); hover or focus
 * a mark for its city and counts.
 *
 * Every colour is the page's tokens (`admin.css`, `.world-map`), so the map follows the theme. A
 * city's coordinates are the collector's, the city's own to a tenth of a degree, never a visitor's.
 */

import { geoEqualEarth, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { el, tipMotion } from "./charts.js";

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 960;
const HEIGHT = 420;

export type MapPlace = { name: string; lat: number; lon: number; visits: number; played: number };

const topology = world as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
// Antarctica (ISO 010) is left off: no one plays from it, and in this projection it is a wide band of nothing.
const countries = topology.objects.countries.geometries.filter((g) => String(g.id) !== "010");
const LAND = feature(topology, { ...topology.objects.countries, geometries: countries }) as GeoPermissibleObjects;
const BORDERS = mesh(topology, { ...topology.objects.countries, geometries: countries }, (a, b) => a !== b) as GeoPermissibleObjects;

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** The marks' radii: 3 to 14 px at the map's own size, by the square root of the visits against the most any city had. */
export function radiusOf(visits: number, most: number): number {
  return 3 + 11 * Math.sqrt(Math.min(1, Math.max(0, visits) / Math.max(1, most)));
}

export function worldMap(places: MapPlace[]): HTMLElement {
  const projection = geoEqualEarth().rotate([-11, 0]).fitSize([WIDTH, HEIGHT], LAND);
  const path = geoPath(projection);
  const svg = node("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img", "aria-label": `A map of the world with ${places.length} cities marked` });
  svg.append(
    node("path", { class: "land", d: path(LAND) ?? "" }),
    node("path", { class: "borders", d: path(BORDERS) ?? "" }),
  );
  const marks = node("g", { class: "marks" });
  svg.append(marks);
  const tip = el("div", { class: "tooltip" });
  const tipping = tipMotion(tip, { glide: false });
  const wrap = el("div", { class: "chart world-map" }, svg, tip);
  const most = Math.max(1, ...places.map((p) => p.visits));
  // The smallest drawn last, so a big city never hides a small one beside it.
  for (const p of [...places].sort((a, b) => b.visits - a.visits)) {
    const at = projection([p.lon, p.lat]);
    if (at === null) continue;
    const r = radiusOf(p.visits, most);
    const g = node("g", { class: "mark", tabindex: "0", transform: `translate(${at[0]},${at[1]})`, "aria-label": `${p.name}: ${p.visits} visits, ${p.played} reached a game` });
    g.append(node("circle", { class: "ring", r: String(r) }), node("circle", { class: "fill", r: String(p.visits > 0 ? r * Math.sqrt(p.played / p.visits) : 0) }));
    const show = (): void => {
      tip.replaceChildren(el("div", {}, el("span", { class: "v" }, p.name)), el("div", { class: "k" }, `${p.visits} visit${p.visits === 1 ? "" : "s"} · ${p.played} reached a game`));
      const box = svg.getBoundingClientRect();
      tip.style.left = `${Math.min((at[0] / WIDTH) * box.width + 12, box.width - 180)}px`;
      tip.style.top = `${Math.max(0, (at[1] / HEIGHT) * box.height - 48)}px`;
      tipping.show();
    };
    g.addEventListener("pointerenter", show);
    g.addEventListener("focus", show);
    g.addEventListener("pointerleave", () => tipping.hide());
    g.addEventListener("blur", () => tipping.hide());
    marks.append(g);
  }
  return wrap;
}
