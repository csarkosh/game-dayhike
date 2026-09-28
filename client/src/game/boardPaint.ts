/**
 * Paints the trailhead board's face: the trail's name and the distance
 * routed into the wood, three sheets of aged paper with their staples, the
 * map, the missing hiker's poster, the rules, and the wear on all of it.
 * The texture is clear wherever the board's own planks show.
 *
 * What is drawn, and where, is decided by pure modules (`boardFace.ts`,
 * `boardMap.ts`, `boardWear.ts`); this is the one module that touches a
 * canvas, and only `wrap`, `paperCrop`, `portraitCrop`, `boardDrawingOf`,
 * `boardMaterial` and `whenImagesArrive` of it run without one.
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { BOARD_TEXTURE, DISTANCE, SHEETS, TITLE, boardText, type BoardText, type Sheet, type SheetName } from "./boardFace.js";
import { boardMap, type BoardMap, type MapInput } from "./boardMap.js";
import { sheetWear, type SheetWear } from "./boardWear.js";
import { labelWear, nameHash } from "./labelWear.js";
import { CARVED, CARVED_LIP, scrape } from "./signMeshes.js";

export type BoardDrawing = {
  seed: number;
  text: BoardText;
  map: MapInput;
  urls: { paper: string | null; portrait: string | null };
};
export type BoardPainter = (scene: Scene, name: string, drawing: BoardDrawing) => Material;

/** The paper where there is no image of it. */
const PAPER = "#E8E2D2";
const INK = "#2a2219";
const RED = "#6d1f17";
const SANS = `"Trebuchet MS", "Helvetica Neue", Arial, sans-serif`;
const SERIF = `Georgia, "Times New Roman", serif`;
/** Metres between the road's samples on the map. */
const ROAD_STEP = 25;
const MAP_MARGIN_M = 60;

/** Breaks a line at its spaces so that each part fits `width`; a word wider than that gets a line of its own. */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(next) > width) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== "") out.push(line);
  return out;
}

/**
 * The part of the square paper image a sheet is cut from: the largest
 * rectangle of the sheet's proportions that fits in three-fifths of the
 * image, at a place the sheet's name decides, so no two sheets show the
 * same fibres.
 */
export function paperCrop(name: string, rect: { width: number; height: number }, size: number): { x: number; y: number; width: number; height: number } {
  const room = size * 0.6;
  const scale = Math.min(room / rect.width, room / rect.height);
  const width = rect.width * scale, height = rect.height * scale;
  const h = nameHash(name);
  const fx = (h & 0xffff) / 0xffff, fy = ((h >>> 16) & 0xffff) / 0xffff;
  return { x: fx * (size - width), y: fy * (size - height), width, height };
}

/** The photograph's print on the poster: four wide to five tall. */
const PRINT_ASPECT = 0.8;

/**
 * The part of the photograph the print shows: the largest four-by-five that
 * fits, from the middle, so a photograph of another shape is cut and never
 * stretched.
 */
export function portraitCrop(image: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const width = Math.min(image.width, image.height * PRINT_ASPECT);
  const height = width / PRINT_ASPECT;
  return { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height };
}

export type BoardSource = {
  seed: number;
  trailName: string;
  hikerName: string;
  lastSeen: string;
  graph: {
    nodes: readonly { x: number; z: number }[];
    edges: readonly { a: number; b: number; kind: string }[];
    features: readonly { kind: string; x: number; z: number; radius: number }[];
    shortestHome: number;
  };
  places: readonly { name: string; x: number; z: number }[];
  summitName: string;
  roadCenterX(seed: number, z: number): number;
  urls: { paper: string | null; portrait: string | null };
};

/** What the painter draws, gathered from a world's graph, names and seed. */
export function boardDrawingOf(source: BoardSource): BoardDrawing {
  let z0 = Infinity, z1 = -Infinity;
  for (const n of source.graph.nodes) {
    if (n.z < z0) z0 = n.z;
    if (n.z > z1) z1 = n.z;
  }
  const road: { x: number; z: number }[] = [];
  if (z0 <= z1) {
    for (let z = z0 - MAP_MARGIN_M; z <= z1 + MAP_MARGIN_M; z += ROAD_STEP) road.push({ x: source.roadCenterX(source.seed, z), z });
  }
  return {
    seed: source.seed,
    text: boardText(source.trailName, source.hikerName, source.lastSeen, source.graph.shortestHome),
    map: {
      nodes: source.graph.nodes.map((n) => ({ x: n.x, z: n.z })),
      edges: source.graph.edges.map((e) => ({ a: e.a, b: e.b, kind: e.kind })),
      road,
      features: source.graph.features.map((f) => ({ kind: f.kind, x: f.x, z: f.z, radius: f.radius })),
      places: source.places.map((p) => ({ name: p.name, x: p.x, z: p.z })),
      summitName: source.summitName,
    },
    urls: source.urls,
  };
}

type Ctx = CanvasRenderingContext2D;
type Images = { paper: CanvasImageSource | null; portrait: CanvasImageSource | null };

/** One routed line, centred, its capitals `height` tall, worn as a fork sign's name is. */
function routed(ctx: Ctx, text: string, at: { centreX: number; centreY: number; height: number }): void {
  const size = Math.round(at.height / 0.72);
  ctx.font = `bold ${size}px ${SANS}`;
  const spaced = Array.from(text).join("  ");
  const metrics = ctx.measureText(spaced);
  const x = at.centreX - metrics.width / 2;
  const baseline = at.centreY + at.height / 2;
  const lip = Math.max(1, Math.round(size * 0.05));
  const ink = { x, y: baseline - at.height, width: metrics.width, height: at.height + lip };
  const wear = labelWear(text, ink);
  const chars = Array.from(spaced);
  let letter = 0;
  for (const [i, char] of chars.entries()) {
    const left = x + ctx.measureText(chars.slice(0, i).join("")).width;
    const faded = char === " " ? 1 : (wear.letters[letter++] ?? 1);
    ctx.globalAlpha = wear.alpha * faded;
    ctx.fillStyle = CARVED_LIP;
    ctx.fillText(char, left, baseline + lip);
    ctx.fillStyle = CARVED;
    ctx.fillText(char, left, baseline);
  }
  ctx.globalAlpha = 1;
  scrape(ctx, wear);
}

function centred(ctx: Ctx, lines: readonly string[], centreX: number, top: number, leading: number): number {
  let y = top;
  for (const line of lines) {
    ctx.fillText(line, centreX - ctx.measureText(line).width / 2, y);
    y += leading;
  }
  return y;
}

function drawMap(ctx: Ctx, heading: string, map: BoardMap, w: number): void {
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.round(w * 0.022)}px ${SANS}`;
  ctx.fillText(Array.from(heading).join(" "), w * 0.03, w * 0.045);
  ctx.strokeStyle = "rgba(122, 106, 79, 0.5)";
  ctx.lineWidth = 1;
  for (const r of map.rings) {
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(111, 135, 144, 0.55)";
  for (const p of map.ponds) {
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry * 0.8, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#4a4136";
  ctx.lineWidth = 7;
  ctx.beginPath();
  for (const [i, p] of map.road.entries()) {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.strokeStyle = "#5a4a36";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([9, 7]);
  for (const l of map.side) {
    ctx.beginPath();
    ctx.moveTo(l.x0, l.y0);
    ctx.lineTo(l.x1, l.y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "#3b2f22";
  ctx.lineWidth = 4.5;
  for (const l of map.stem) {
    ctx.beginPath();
    ctx.moveTo(l.x0, l.y0);
    ctx.lineTo(l.x1, l.y1);
    ctx.stroke();
  }
  ctx.fillStyle = "#3b2f22";
  if (map.summit !== null) {
    ctx.beginPath();
    ctx.moveTo(map.summit.x - 12, map.summit.y + 9);
    ctx.lineTo(map.summit.x, map.summit.y - 14);
    ctx.lineTo(map.summit.x + 12, map.summit.y + 9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = `italic ${Math.round(w * 0.024)}px ${SERIF}`;
  for (const l of map.labels) ctx.fillText(l.text, l.x + 18, l.y + 8);
  ctx.fillStyle = "#8a2f23";
  ctx.beginPath();
  ctx.arc(map.here.x, map.here.y, 9, 0, 2 * Math.PI);
  ctx.fill();
  ctx.font = `bold ${Math.round(w * 0.019)}px ${SANS}`;
  const here = "YOU ARE HERE";
  ctx.fillText(here, map.here.x - 18 - ctx.measureText(here).width, map.here.y - 16);
}

function drawPoster(ctx: Ctx, text: BoardText["poster"], portrait: CanvasImageSource | null, w: number, h: number): void {
  ctx.fillStyle = RED;
  ctx.font = `900 ${Math.round(w * 0.15)}px ${SERIF}`;
  const title = Array.from(text.title).join(" ");
  ctx.fillText(title, (w - ctx.measureText(title).width) / 2, h * 0.13);
  const pw = w * 0.5, ph = pw / PRINT_ASPECT, px = (w - pw) / 2, py = h * 0.17;
  if (portrait !== null) {
    ctx.save();
    ctx.globalAlpha *= 0.78;
    const from = portrait as { width?: number; height?: number };
    const c = portraitCrop({ width: from.width ?? 512, height: from.height ?? 512 });
    ctx.drawImage(portrait, c.x, c.y, c.width, c.height, px, py, pw, ph);
    ctx.restore();
    // Bleached: a pale wash over the print, as the sun leaves one.
    ctx.fillStyle = "rgba(232, 226, 210, 0.34)";
    ctx.fillRect(px, py, pw, ph);
  } else {
    const grey = ctx.createLinearGradient(px, py, px + pw, py + ph);
    grey.addColorStop(0, "#9b917c");
    grey.addColorStop(1, "#6f6655");
    ctx.fillStyle = grey;
    ctx.fillRect(px, py, pw, ph);
  }
  ctx.fillStyle = INK;
  let size = Math.round(w * 0.095);
  ctx.font = `bold ${size}px ${SERIF}`;
  const room = w * 0.9;
  if (ctx.measureText(text.name).width > room) {
    size = Math.max(14, Math.floor((size * room) / ctx.measureText(text.name).width));
    ctx.font = `bold ${size}px ${SERIF}`;
  }
  let y = py + ph + h * 0.075;
  ctx.fillText(text.name, (w - ctx.measureText(text.name).width) / 2, y);
  ctx.font = `${Math.round(w * 0.056)}px ${SERIF}`;
  y += h * 0.055;
  for (const line of text.lines) {
    y = centred(ctx, wrap(line, room, (s) => ctx.measureText(s).width), w / 2, y, h * 0.045) + h * 0.012;
  }
}

function drawRules(ctx: Ctx, text: BoardText["rules"], w: number, h: number): void {
  ctx.fillStyle = INK;
  ctx.font = `800 ${Math.round(w * 0.09)}px ${SANS}`;
  const heading = Array.from(text.heading).join(" ");
  ctx.fillText(heading, (w - ctx.measureText(heading).width) / 2, h * 0.1);
  ctx.fillRect(w * 0.08, h * 0.125, w * 0.84, Math.max(2, h * 0.004));
  ctx.font = `bold ${Math.round(w * 0.08)}px ${SANS}`;
  let y = h * 0.21;
  for (const line of text.lines) {
    y = centred(ctx, wrap(line, w * 0.86, (s) => ctx.measureText(s).width), w / 2, y, h * 0.062) + h * 0.03;
  }
  ctx.globalAlpha *= 0.8;
  ctx.font = `${Math.round(w * 0.058)}px ${SERIF}`;
  for (const line of text.small) {
    y = centred(ctx, wrap(line, w * 0.86, (s) => ctx.measureText(s).width), w / 2, y, h * 0.05);
  }
}

/** A sheet's print, worn: drawn apart, its fades rubbed out of it, then laid on the paper. */
function printed(sheet: Sheet, wear: SheetWear, draw: (ctx: Ctx, w: number, h: number) => void): HTMLCanvasElement {
  const { width: w, height: h } = sheet.rect;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext("2d") as Ctx;
  ctx.globalAlpha = wear.ink;
  draw(ctx, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  for (const f of wear.fades) {
    const fade = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    fade.addColorStop(0, `rgba(0, 0, 0, ${f.strength})`);
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(f.x - f.r, f.y - f.r, 2 * f.r, 2 * f.r);
  }
  return canvas;
}

function drawSheet(ctx: Ctx, sheet: Sheet, wear: SheetWear, images: Images, print: HTMLCanvasElement | null): void {
  const { x, y, width: w, height: h, turn } = sheet.rect;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(turn);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  if (sheet.staples) {
    ctx.rect(0, 0, w, h);
  } else {
    // A corner left when the rest of a notice was torn away.
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h * 0.55);
    ctx.lineTo(w * 0.62, h);
    ctx.lineTo(w * 0.38, h * 0.62);
    ctx.lineTo(0, h * 0.84);
    ctx.closePath();
  }
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  if (images.paper !== null) {
    const size = (images.paper as { width?: number }).width ?? 512;
    const c = paperCrop(sheet.name, sheet.rect, size);
    ctx.drawImage(images.paper, c.x, c.y, c.width, c.height, 0, 0, w, h);
  }
  const corner = [[0, 0], [w, 0], [w, h], [0, h]][wear.bleach.corner] as [number, number];
  const bleach = ctx.createRadialGradient(corner[0], corner[1], 0, corner[0], corner[1], wear.bleach.r);
  bleach.addColorStop(0, `rgba(255, 252, 240, ${wear.bleach.strength})`);
  bleach.addColorStop(1, "rgba(255, 252, 240, 0)");
  ctx.fillStyle = bleach;
  ctx.fillRect(0, 0, w, h);
  const stain = ctx.createRadialGradient(wear.stain.x, wear.stain.y, wear.stain.r * 0.2, wear.stain.x, wear.stain.y, wear.stain.r);
  stain.addColorStop(0, `rgba(120, 84, 40, ${wear.stain.strength * 0.6})`);
  stain.addColorStop(0.85, `rgba(120, 84, 40, ${wear.stain.strength})`);
  stain.addColorStop(1, "rgba(120, 84, 40, 0)");
  ctx.fillStyle = stain;
  ctx.fillRect(0, 0, w, h);
  if (print !== null) ctx.drawImage(print, 0, 0);
  if (sheet.staples) {
    const inset = Math.min(w, h) * 0.045;
    const at: [number, number][] = [[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]];
    for (const [k, [sx, sy]] of at.entries()) {
      const r = wear.rust[k] as { strength: number; run: number };
      const run = ctx.createLinearGradient(0, sy, 0, sy + r.run);
      run.addColorStop(0, `rgba(122, 58, 24, ${r.strength})`);
      run.addColorStop(1, "rgba(122, 58, 24, 0)");
      ctx.fillStyle = run;
      ctx.fillRect(sx - 14, sy, 28, r.run);
      const steel = ctx.createLinearGradient(0, sy - 3, 0, sy + 3);
      steel.addColorStop(0, "#9a958c");
      steel.addColorStop(1, "#5b564e");
      ctx.fillStyle = steel;
      ctx.fillRect(sx - 14, sy - 3, 28, 6);
    }
  }
  ctx.restore();
}

function draw(ctx: Ctx, drawing: BoardDrawing, images: Images): void {
  ctx.clearRect(0, 0, BOARD_TEXTURE.width, BOARD_TEXTURE.height);
  routed(ctx, drawing.text.title, TITLE);
  routed(ctx, drawing.text.distance, DISTANCE);
  for (const sheet of SHEETS) {
    const wear = sheetWear(drawing.seed, sheet.name, sheet.rect);
    const { width: w, height: h } = sheet.rect;
    const prints: Record<SheetName, ((c: Ctx) => void) | null> = {
      torn: null,
      map: (c) => drawMap(c, drawing.text.mapHeading, boardMap(drawing.map, { x: w * 0.03, y: w * 0.07, width: w * 0.94, height: h - w * 0.1 }), w),
      poster: (c) => drawPoster(c, drawing.text.poster, images.portrait, w, h),
      rules: (c) => drawRules(c, drawing.text.rules, w, h),
    };
    const print = prints[sheet.name];
    drawSheet(ctx, sheet, wear, images, print === null ? null : printed(sheet, wear, (c) => print(c)));
  }
}

/**
 * Waits for the images that have an address and asks for the face to be
 * drawn once more with whichever arrived. Nothing is asked for where there
 * is no address, and nothing is drawn where none arrived or the texture has
 * gone in the meantime. A drawing that fails costs the look, never the
 * match: what was drawn before it stays.
 */
export async function whenImagesArrive<T>(
  urls: { paper: string | null; portrait: string | null },
  load: (url: string) => Promise<T | null>,
  gone: () => boolean,
  redraw: (images: { paper: T | null; portrait: T | null }) => void,
): Promise<void> {
  if (urls.paper === null && urls.portrait === null) return;
  const [paper, portrait] = await Promise.all([
    urls.paper === null ? null : load(urls.paper),
    urls.portrait === null ? null : load(urls.portrait),
  ]);
  if (gone() || (paper === null && portrait === null)) return;
  try {
    redraw({ paper, portrait });
  } catch {
    // The stand-ins stay.
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // A missing image costs the look, never the board: the stand-in stays.
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * How far the face's paint is biased toward the eye, in the depth buffer's
 * own steps. A plane 2 mm in front of the planks still lost to them from
 * some standpoints beyond about 3 m (see `BOARD_FACE_LIFT`): on each of the
 * 15 where it did, out to 14 m, a bias of 60 steps or fewer put it back.
 * This is twice that.
 */
export const BOARD_FACE_BIAS = -120;

/** The face's material, without its texture: clear wherever the texture is, and drawn over the planks behind it. */
export function boardMaterial(scene: Scene, name: string): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.useAlphaFromAlbedoTexture = true;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  // The clear ground must stay clear: no reflection or highlight kept where
  // the alpha is zero, which would lay a sheen over the planks.
  material.useRadianceOverAlpha = false;
  material.useSpecularOverAlpha = false;
  material.backFaceCulling = true;
  // The slope's share of the bias, which is nothing where the face is
  // looked at square on, and the constant share, which holds there.
  material.zOffset = -1;
  material.zOffsetUnits = BOARD_FACE_BIAS;
  material.metallic = 0;
  material.roughness = 0.92;
  return material;
}

/**
 * The face's material: drawn at once with stand-ins for the paper and the
 * photograph, and drawn again with the images when they arrive. An image
 * that arrives after the texture is disposed is dropped.
 */
export const paintedBoard: BoardPainter = (scene, name, drawing) => {
  // Mipmapped: the board is read from a few metres, where a 2048-wide
  // texture on a 2 m plane is heavily minified and would shimmer without.
  const texture = new DynamicTexture(name, { width: BOARD_TEXTURE.width, height: BOARD_TEXTURE.height }, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as unknown as Ctx;
  draw(ctx, drawing, { paper: null, portrait: null });
  texture.update(true);
  let disposed = false;
  texture.onDisposeObservable.add(() => {
    disposed = true;
  });
  void whenImagesArrive(drawing.urls, loadImage, () => disposed, (images) => {
    draw(ctx, drawing, images);
    texture.update(true);
  });
  const material = boardMaterial(scene, `${name}_mat`);
  material.albedoTexture = texture;
  return material;
};
