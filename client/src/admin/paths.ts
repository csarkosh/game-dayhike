/**
 * Where parties went, drawn: the trail the world's seed makes, the players'
 * samples over it as one line a session, the route's events as marks, and a
 * scrubber over sim time. One world at a time, since positions are the
 * world's own frame. The trail comes from a worker (`trail.worker.ts`); until
 * it answers, the samples are drawn alone.
 */

import { ago, compact, el, table, tile, type Column } from "./charts.js";
import type { Row } from "./source.js";
import { sameGeneration, type DrawableTrail, type TrailAnswer, type TrailRequest } from "./trail.js";

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const bool = (v: unknown): boolean => v === true || v === "true";

type Sample = { tick: number; x: number; z: number; yaw: number; p: number; hp: number; lamp: boolean; sprint: boolean; off: number; lens: number; near: number };
type Mark = { tick: number; n: string; x: number; z: number; label: string };
type Session = { sid: string; role: string; samples: Sample[]; marks: Mark[]; farthest: number; result: string; died: boolean; walkedLoop: boolean; loopEdges: Set<number>; offTrail: boolean; lamp: boolean; places: string[]; ticks: number };

const CANVAS = 640;
const PAD = 28;

/** A world the rows hold: its version and seed, and when its first row was sent. */
export type World = { key: string; world: string; seed: string; startedAt: number };

/**
 * The worlds the rows hold, newest first: each world's version and seed, and
 * the moment its earliest row was sent (the server's clock), which is when its
 * party set out. Two parties on one seed share one entry, dated by the first.
 */
export function worldsOf(rows: Row[]): World[] {
  const by = new Map<string, World>();
  for (const r of rows) {
    const world = str(r.world);
    const seed = str(r.seed);
    if (world === "" && seed === "") continue;
    const key = `${world}|${seed}`;
    const at = Date.parse(str(r.timestamp));
    const w = by.get(key);
    if (w === undefined) by.set(key, { key, world, seed, startedAt: Number.isNaN(at) ? Infinity : at });
    else if (!Number.isNaN(at) && at < w.startedAt) w.startedAt = at;
  }
  return [...by.values()].sort((a, b) => b.startedAt - a.startedAt || a.key.localeCompare(b.key));
}

const whenFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/** A world's list entry: when its party set out, in New York time, then the world and its seed. */
export function worldLabel(w: World): string {
  const when = Number.isFinite(w.startedAt) ? whenFormat.format(w.startedAt) : "undated";
  return `${when} · ${w.world} · seed ${w.seed}`;
}

/** The rows of one world, grouped into sessions with their samples and marks in tick order. */
export function sessionsOf(rows: Row[]): Session[] {
  const by = new Map<string, Session>();
  for (const r of rows) {
    const sid = str(r.sid);
    let s = by.get(sid);
    if (s === undefined) {
      s = { sid, role: "", samples: [], marks: [], farthest: 0, result: "", died: false, walkedLoop: false, loopEdges: new Set(), offTrail: false, lamp: false, places: [], ticks: 0 };
      by.set(sid, s);
    }
    const n = str(r.n);
    const tick = num(r.tick);
    s.ticks = Math.max(s.ticks, tick);
    if (n === "pos") {
      const sample: Sample = { tick, x: num(r.x), z: num(r.z), yaw: num(r.yaw), p: num(r.p), hp: num(r.hp), lamp: bool(r.lamp), sprint: bool(r.sprint), off: num(r.off), lens: num(r.lens), near: num(r.near) };
      s.samples.push(sample);
      s.farthest = Math.max(s.farthest, sample.p);
      if (sample.lamp) s.lamp = true;
      continue;
    }
    if (n === "match_start") s.role = str(r.role);
    if (n === "outcome") s.result = str(r.result);
    // A loop walked is two of its edges, not one: passing a junction can
    // put the nearest edge on the loop for a sample.
    if (n === "edge" && str(r.kind) !== "stem") {
      s.loopEdges.add(num(r.edge));
      if (s.loopEdges.size >= 2) s.walkedLoop = true;
    }
    if (n === "offtrail") s.offTrail = true;
    if (n === "lamp" && bool(r.lamp_on)) s.lamp = true;
    if (n === "place" && bool(r.in_place)) {
      const name = str(r.name) || str(r.kind);
      if (!s.places.includes(name)) s.places.push(name);
    }
    if (n === "death") {
      s.died = true;
      s.marks.push({ tick, n, x: num(r.x), z: num(r.z), label: "died" });
    }
    if (n === "hollow_seen" || n === "poster" || n === "offtrail" || n === "fork" || n === "cut") {
      s.marks.push({ tick, n, x: num(r.x), z: num(r.z), label: n === "hollow_seen" ? "saw the Hollow" : n === "poster" ? "read the poster" : n === "offtrail" ? "left the trail" : n === "cut" ? `cut at fork ${str(r.node)}` : `fork ${str(r.node)}` });
    }
  }
  for (const s of by.values()) {
    s.samples.sort((a, b) => a.tick - b.tick);
    s.marks.sort((a, b) => a.tick - b.tick);
    // A mark with no position of its own sits at the nearest sample in time.
    for (const m of s.marks) {
      if (m.x !== 0 || m.z !== 0 || s.samples.length === 0) continue;
      let best = s.samples[0]!;
      for (const sample of s.samples) if (Math.abs(sample.tick - m.tick) < Math.abs(best.tick - m.tick)) best = sample;
      m.x = best.x;
      m.z = best.z;
    }
  }
  return [...by.values()].sort((a, b) => b.ticks - a.ticks);
}

type Fit = { sx: (x: number) => number; sy: (z: number) => number; scale: number };

/** The drawing's frame: the trail's and the samples' bounds, padded, north (negative z) up. */
function fit(trail: DrawableTrail | null, sessions: Session[]): Fit {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const take = (x: number, z: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  if (trail !== null) {
    for (const n of trail.nodes) take(n.x, n.z);
    for (const f of trail.features) {
      take(f.x - f.radius, f.z - f.radius);
      take(f.x + f.radius, f.z + f.radius);
    }
  }
  for (const s of sessions) for (const p of s.samples) take(p.x, p.z);
  if (!Number.isFinite(minX)) {
    minX = -100; maxX = 100; minZ = -100; maxZ = 100;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const scale = (CANVAS - PAD * 2) / span;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return { sx: (x) => CANVAS / 2 + (x - cx) * scale, sy: (z) => CANVAS / 2 + (z - cz) * scale, scale };
}

const token = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function drawTrail(ctx: CanvasRenderingContext2D, trail: DrawableTrail, f: Fit): void {
  const ink2 = token("--ink-2", "#52514e");
  const muted = token("--muted", "#898781");
  const grid = token("--grid", "#e1e0d9");
  const soft = token("--series-soft", "rgba(42,120,214,0.12)");
  ctx.font = "11px system-ui, sans-serif";
  for (const feat of trail.features) {
    ctx.beginPath();
    ctx.arc(f.sx(feat.x), f.sy(feat.z), feat.radius * f.scale, 0, Math.PI * 2);
    ctx.fillStyle = soft;
    ctx.fill();
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.fillText(feat.name === "" ? feat.kind : `${feat.name} (${feat.kind})`, f.sx(feat.x), f.sy(feat.z) + feat.radius * f.scale + 12);
  }
  for (const e of trail.edges) {
    const a = trail.nodes[e.a]!;
    const b = trail.nodes[e.b]!;
    ctx.beginPath();
    ctx.moveTo(f.sx(a.x), f.sy(a.z));
    ctx.lineTo(f.sx(b.x), f.sy(b.z));
    ctx.strokeStyle = e.kind === "stem" ? ink2 : muted;
    ctx.lineWidth = e.kind === "stem" ? 3 : 1.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  for (const node of trail.forks) {
    const n = trail.nodes[node]!;
    ctx.beginPath();
    ctx.arc(f.sx(n.x), f.sy(n.z), 4, 0, Math.PI * 2);
    ctx.fillStyle = token("--surface", "#fcfcfb");
    ctx.fill();
    ctx.strokeStyle = ink2;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = "left";
    ctx.fillText(String(node), f.sx(n.x) + 6, f.sy(n.z) - 6);
  }
  ctx.fillStyle = ink2;
  ctx.textAlign = "center";
  ctx.fillText("trailhead", f.sx(trail.trailhead.x), f.sy(trail.trailhead.z) + 16);
  const crest = trail.nodes[trail.summit];
  if (crest !== undefined) ctx.fillText("crest", f.sx(crest.x), f.sy(crest.z) - 8);
}

function drawSessions(ctx: CanvasRenderingContext2D, sessions: Session[], f: Fit, upTo: number, selected: string | null): void {
  const series = token("--series", "#2a78d6");
  const de = token("--de", "#c3c2b7");
  const critical = token("--critical", "#d03b3b");
  const ink = token("--ink", "#0b0b0b");
  const ordered = [...sessions.filter((s) => s.sid !== selected), ...sessions.filter((s) => s.sid === selected)];
  for (const s of ordered) {
    const own = selected === null || s.sid === selected;
    const pts = s.samples.filter((p) => p.tick <= upTo);
    if (pts.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(f.sx(pts[0]!.x), f.sy(pts[0]!.z));
    for (const p of pts) ctx.lineTo(f.sx(p.x), f.sy(p.z));
    ctx.strokeStyle = own ? series : de;
    ctx.globalAlpha = own ? (selected === null ? 0.55 : 0.95) : 0.5;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;
    // The head of the line at the scrubber's time.
    const last = pts[pts.length - 1]!;
    ctx.beginPath();
    ctx.arc(f.sx(last.x), f.sy(last.z), 4, 0, Math.PI * 2);
    ctx.fillStyle = own ? series : de;
    ctx.fill();
    ctx.strokeStyle = token("--surface", "#fcfcfb");
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const m of s.marks) {
      if (m.tick > upTo) continue;
      const x = f.sx(m.x);
      const y = f.sy(m.z);
      ctx.lineWidth = 2;
      if (m.n === "death") {
        ctx.strokeStyle = critical;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        ctx.stroke();
      } else if (m.n === "hollow_seen") {
        ctx.strokeStyle = own ? ink : de;
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 6, y);
        ctx.closePath();
        ctx.stroke();
      } else if (m.n === "poster") {
        ctx.strokeStyle = own ? ink : de;
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      }
    }
  }
}

const mmss = (tick: number): string => {
  const s = Math.round(tick / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The paths card: the world selector, the drawing with its scrubber, and the sessions beside it. */
export function pathsCard(rows: Row[], trailFor: (world: string, seed: number) => Promise<DrawableTrail | null>): HTMLElement {
  // Newest party first, so the list opens on the latest walk.
  const worlds = worldsOf(rows);
  const select = el("select", {}, ...worlds.map((w) => el("option", { value: w.key }, worldLabel(w))));
  const canvas = el("canvas", { width: String(CANVAS), height: String(CANVAS) });
  const scrub = el("input", { type: "range", min: "0", max: "1", value: "1", step: "1", style: "width:100%" });
  const clock = el("span", { class: "sub" }, "");
  const note = el("p", { class: "sub" }, "");
  const side = el("div", { class: "side" });
  const tip = el("div", { class: "tooltip" });
  const wrap = el("div", { class: "chart" }, canvas, tip);
  let sessions: Session[] = [];
  let trail: DrawableTrail | null = null;
  let frame: Fit = fit(null, []);
  let selected: string | null = null;
  let ticks = 1;

  const draw = (): void => {
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    frame = fit(trail, sessions);
    if (trail !== null) drawTrail(ctx, trail, frame);
    const upTo = Number(scrub.value);
    drawSessions(ctx, sessions, frame, upTo, selected);
    clock.textContent = `${mmss(upTo)} of ${mmss(ticks)} into the match`;
  };

  const sidePanel = (): void => {
    const cols: Column[] = [
      { key: "sid", label: "Session", render: (v) => el("a", { href: "#", class: "mono", "data-sid": str(v), "data-pick": str(v) }, str(v).slice(0, 8)) },
      { key: "role", label: "Role" },
      { key: "farthest", label: "Farthest", num: true, render: (v) => `${Math.round(num(v) * 100)}%` },
      { key: "minutes", label: "Min", num: true },
      { key: "went", label: "Went" },
      { key: "end", label: "End", render: (v) => el("span", { class: `status ${str(v) === "won" ? "won" : str(v) === "lost" || str(v) === "died" ? "lost" : ""}` }, str(v) || "–") },
    ];
    const rowsOut = sessions.map((s) => ({
      sid: s.sid,
      role: s.role,
      farthest: s.farthest,
      minutes: Math.round((s.ticks / 3600) * 10) / 10,
      went: [s.walkedLoop ? "loop" : "", s.offTrail ? "off trail" : "", s.lamp ? "lamp" : "", ...s.places].filter((w) => w !== "").join(", "),
      end: s.died ? "died" : s.result,
    }));
    side.replaceChildren(
      el(
        "div",
        { class: "tiles" },
        tile("Sessions", String(sessions.length)),
        tile("Walked a loop", String(sessions.filter((s) => s.walkedLoop).length)),
        tile("Left the trail", String(sessions.filter((s) => s.offTrail).length)),
        tile("Used the lamp", String(sessions.filter((s) => s.lamp).length)),
        tile("Died", String(sessions.filter((s) => s.died).length)),
        tile("Samples", compact(sessions.reduce((n, s) => n + s.samples.length, 0))),
      ),
      el("p", { class: "sub" }, "Click a session to follow it alone; click again for all. The id opens its timeline."),
      table(cols, rowsOut, "No samples for this world in the range."),
    );
  };

  const choose = (): void => {
    const [world = "", seed = ""] = (select.value || "|").split("|");
    const own = rows.filter((r) => str(r.world) === world && str(r.seed) === seed);
    sessions = sessionsOf(own);
    ticks = Math.max(1, ...sessions.map((s) => s.ticks));
    scrub.max = String(ticks);
    scrub.value = String(ticks);
    selected = null;
    trail = null;
    note.textContent = world === "" ? "" : sameGeneration(world) ? "The trail is rebuilt from the seed by this build's generator." : "This session's world was made by another generation of the generator; the trail drawn here may differ from the one they walked.";
    sidePanel();
    draw();
    if (world !== "") {
      void trailFor(world, Number(seed)).then((built) => {
        if (select.value !== `${world}|${seed}`) return;
        trail = built;
        if (built === null) note.textContent = `${note.textContent} The trail could not be rebuilt for this world.`.trim();
        draw();
      });
    }
  };

  select.addEventListener("change", choose);
  scrub.addEventListener("input", draw);
  side.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const pick = target.closest<HTMLElement>("[data-pick]")?.dataset.pick;
    if (pick === undefined) return;
    selected = selected === pick ? null : pick;
    draw();
  });
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * CANVAS;
    const py = ((event.clientY - rect.top) / rect.height) * CANVAS;
    const upTo = Number(scrub.value);
    let best: { s: Session; p: Sample; d: number } | null = null;
    for (const s of sessions) {
      if (selected !== null && s.sid !== selected) continue;
      for (const p of s.samples) {
        if (p.tick > upTo) continue;
        const d = Math.hypot(frame.sx(p.x) - px, frame.sy(p.z) - py);
        if (d < 12 && (best === null || d < best.d)) best = { s, p, d };
      }
    }
    if (best === null) {
      tip.style.display = "none";
      return;
    }
    const { s, p } = best;
    tip.replaceChildren(
      el("div", {}, el("span", { class: "v" }, `${mmss(p.tick)}`), " ", el("span", { class: "k" }, `session ${s.sid.slice(0, 8)}`)),
      el("div", { class: "k" }, `climb ${Math.round(p.p * 100)}% · hp ${p.hp}${p.lamp ? " · lamp" : ""}${p.sprint ? " · sprinting" : ""}${p.off > 0 ? ` · off trail ${Math.round(p.off * 100)}%` : ""}`),
      el("div", { class: "k" }, `lens ${Math.round(p.lens * 100)}% · Hollow ${Math.round(p.near * 100)}%`),
    );
    tip.style.display = "block";
    tip.style.left = `${Math.min((px / CANVAS) * rect.width + 12, rect.width - 200)}px`;
    tip.style.top = `${Math.max(0, (py / CANVAS) * rect.height - 60)}px`;
  });
  canvas.addEventListener("pointerleave", () => {
    tip.style.display = "none";
  });

  const card = el(
    "section",
    { class: "card" },
    el("h2", {}, "Where parties went"),
    el("p", { class: "sub" }, "One world at a time: the trail rebuilt from its seed, each session's path over it, a × where they died, a ◇ where they first saw the Hollow, a □ where they read the poster. Hover a path for its moment."),
    el("div", { class: "paths" }, el("div", { class: "drawing" }, el("p", {}, select), wrap, el("div", { class: "scrub" }, scrub, clock), note), side),
  );
  if (worlds.length === 0) {
    side.replaceChildren(el("div", { class: "empty" }, "No position samples in this range."));
  } else {
    choose();
  }
  void ago;
  return card;
}

/** The trail builder, in a worker, one answer a request, with the answers kept. */
export function trailBuilder(): (world: string, seed: number) => Promise<DrawableTrail | null> {
  const cache = new Map<string, Promise<DrawableTrail | null>>();
  let worker: Worker | null = null;
  const waiting = new Map<string, (trail: DrawableTrail | null) => void>();
  return (world, seed) => {
    const key = `${world}|${seed}`;
    const held = cache.get(key);
    if (held !== undefined) return held;
    const made = new Promise<DrawableTrail | null>((resolve) => {
      try {
        if (worker === null) {
          worker = new Worker(new URL("./trail.worker.ts", import.meta.url), { type: "module" });
          worker.onmessage = (event: MessageEvent<TrailAnswer>) => {
            const k = `${event.data.world}|${event.data.seed}`;
            waiting.get(k)?.(event.data.trail);
            waiting.delete(k);
          };
          worker.onerror = () => {
            for (const done of waiting.values()) done(null);
            waiting.clear();
          };
        }
        waiting.set(key, resolve);
        const request: TrailRequest = { world, seed };
        worker.postMessage(request);
      } catch {
        resolve(null);
      }
    });
    cache.set(key, made);
    return made;
  };
}
