/**
 * The register and the count: the book of missing hikers, their items, and
 * the rules that move them. Sites and names follow from the seed and the
 * trail graph (`buildRegister`), so every peer reads the same book with
 * nothing on the wire; the items' state is host world state in the snapshot.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { InputCommand, PlayerState, Vec3, WorldState } from "./types.js";
import { Button, NO_CARRIER, NO_ITEM, Outcome, cloneVec3 } from "./types.js";
import type { World } from "./world.js";
import { resolveInteract } from "./interact.js";
import { PLAYER_HALF } from "./constants.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import type { Landmark } from "./landmarks.js";
import { CAR_HALF } from "./passes/trailhead.js";
import { hikerNames } from "./hikerNames.js";

export const SIGN_OUT_TICKS = 300;
export const CAR_RADIUS = 4;
export const ITEM_RADIUS = 0.35;
export const BOX_RADIUS = 0.4;
/** Chest height on the 1.2 m post, where a hand opens the box. */
export const BOX_HEIGHT = 1;
export const MIN_SITES = 2;
export const MAX_SITES = 4;
/** Metres between any two sites: a fallback site never lands on the summit's doorstep. */
export const SITE_SPACING = 20;
/** Metres between samples when a fallback site is searched along the trail. */
const SITE_SEARCH_STEP = 2;
export const BOX_INTERACTABLE_ID = 2;
export const ITEM_INTERACTABLE_BASE = 10;

export const enum InteractKind {
  Debug = 0,
  Item = 1,
  Register = 2,
}

export type SiteKind = "summit" | "meadow" | "pond" | "stand" | "talus";
export type Site = {
  kind: SiteKind;
  /** As the book reads it: "the summit", "the lower meadow". */
  name: string;
  x: number;
  /** The ground at (x, z). */
  y: number;
  z: number;
  /** Stem progress, 0 at the pad to 1 at the crest: orders two sites of one kind. */
  progress: number;
};
export type Hiker = { id: number; name: string; site: Site };
export type Register = {
  hikers: Hiker[];
  /** The register box on its post: what the hand reaches for. */
  box: Vec3;
  /** The car's centre, for the win. */
  car: Vec3;
};

export type RegisterInput = {
  seed: number;
  graph: TrailGraph;
  landmarks: readonly Landmark[];
  groundH(x: number, z: number): number;
  /** The post's and the car's sites (`propSite` over PROPS[0] and PROPS[2]). */
  box: { x: number; z: number };
  car: { x: number; z: number };
};

const KIND_NAMES: Record<SiteKind, string> = {
  summit: "the summit",
  meadow: "the meadow",
  pond: "the pond",
  stand: "the old stand",
  talus: "the talus field",
};
const ORDINALS = ["lower", "middle", "upper"];

/** `rank` among `count` sites of this kind, ordered by stem progress. */
export function siteDisplayName(kind: SiteKind, rank: number, count: number): string {
  const base = KIND_NAMES[kind];
  if (count <= 1) return base;
  const word = count === 2 ? (rank === 0 ? "lower" : "upper") : (ORDINALS[rank] ?? "upper");
  return base.replace("the ", `the ${word} `);
}

/** The nearest point on any of `edgeIds` to (x, z), with the stem progress there. */
function nearestPointOnEdges(
  graph: TrailGraph,
  edgeIds: readonly number[],
  x: number,
  z: number,
): { x: number; z: number; progress: number } {
  let best = { x, z, progress: 0 };
  let bestSq = Infinity;
  for (const id of edgeIds) {
    const e = graph.edges[id];
    if (e === undefined) continue;
    const a = graph.nodes[e.a] as TrailNode;
    const b = graph.nodes[e.b] as TrailNode;
    const ex = b.x - a.x, ez = b.z - a.z;
    const L2 = ex * ex + ez * ez;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / L2)) : 0;
    const px = a.x + t * ex, pz = a.z + t * ez;
    const sq = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (sq < bestSq) {
      bestSq = sq;
      best = { x: px, z: pz, progress: e.progress0 + (e.progress1 - e.progress0) * t };
    }
  }
  return best;
}

function farFromSites(x: number, z: number, sites: readonly Site[]): boolean {
  for (const s of sites) {
    const dx = s.x - x, dz = s.z - z;
    if (dx * dx + dz * dz < SITE_SPACING * SITE_SPACING) return false;
  }
  return true;
}

/**
 * The trail point nearest (x, z) that keeps SITE_SPACING from every existing
 * site, sampled every SITE_SEARCH_STEP along every edge. A scenery landmark
 * can stand past the crest, where the nearest point on the trail IS the
 * summit (measured: seed 331's stand), so the fallback site is found under
 * the spacing rule rather than projected. Null only on a graph with no edge.
 */
function nearestSpacedPoint(
  graph: TrailGraph,
  x: number,
  z: number,
  sites: readonly Site[],
): { x: number; z: number; progress: number } | null {
  let best: { x: number; z: number; progress: number } | null = null;
  let bestSq = Infinity;
  for (const e of graph.edges) {
    const a = graph.nodes[e.a] as TrailNode;
    const b = graph.nodes[e.b] as TrailNode;
    const ex = b.x - a.x, ez = b.z - a.z;
    const len = Math.sqrt(ex * ex + ez * ez);
    const steps = Math.max(1, Math.ceil(len / SITE_SEARCH_STEP));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + t * ex, pz = a.z + t * ez;
      const sq = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (sq >= bestSq || !farFromSites(px, pz, sites)) continue;
      bestSq = sq;
      best = { x: px, z: pz, progress: e.progress0 + (e.progress1 - e.progress0) * t };
    }
  }
  return best;
}

/**
 * The sites, the names and where the box and the car stand, all from the
 * seed. The summit is always a site and each built loop adds one at its
 * feature; where that leaves a single site, a scenery landmark — the stand,
 * else the talus — becomes the second, at the trail's nearest point, so no
 * item ever asks a player to leave the trail (B §2).
 */
export function buildRegister(input: RegisterInput): Register {
  const { graph, groundH } = input;
  const sites: Site[] = [];
  const crest = graph.nodes[graph.summit] as TrailNode;
  sites.push({ kind: "summit", name: "", x: crest.x, y: groundH(crest.x, crest.z), z: crest.z, progress: 1 });
  for (const loop of graph.loops) {
    const feature = graph.features.find((f) => f.id === loop.featureId);
    if (feature === undefined) continue;
    const p = nearestPointOnEdges(graph, loop.edges, feature.x, feature.z);
    sites.push({ kind: loop.kind, name: "", x: p.x, y: groundH(p.x, p.z), z: p.z, progress: p.progress });
  }
  if (sites.length < MIN_SITES) {
    for (const type of ["stand", "talus"] as const) {
      const landmark = input.landmarks.find((l) => l.type === type);
      if (landmark === undefined) continue;
      const p = nearestSpacedPoint(graph, landmark.x, landmark.z, sites);
      if (p === null) continue;
      sites.push({ kind: type, name: "", x: p.x, y: groundH(p.x, p.z), z: p.z, progress: p.progress });
      break;
    }
  }
  // Names by kind, ordinals by stem progress among a kind.
  for (const kind of Object.keys(KIND_NAMES) as SiteKind[]) {
    const ofKind = sites.filter((s) => s.kind === kind).sort((a, b) => a.progress - b.progress);
    for (const [rank, s] of ofKind.entries()) s.name = siteDisplayName(kind, rank, ofKind.length);
  }
  const names = hikerNames(input.seed, sites.length);
  const hikers = sites.map((site, id) => ({ id, name: names[id] as string, site }));
  return {
    hikers,
    box: { x: input.box.x, y: groundH(input.box.x, input.box.z) + BOX_HEIGHT, z: input.box.z },
    car: { x: input.car.x, y: groundH(input.car.x, input.car.z) + CAR_HALF.y, z: input.car.z },
  };
}

/**
 * Lays the items at their sites and registers the box and the items as
 * interactables. Called on the host's world and on a client's predicted
 * world alike, from the same seed, so both resolve the same things in reach;
 * only the host's `onInteract` has effect (`sim/world.ts`).
 */
export function installRegister(world: World, register: Register): void {
  world.register = register;
  world.state.items = register.hikers.map((h) => ({
    id: h.id,
    pos: { x: h.site.x, y: h.site.y + ITEM_RADIUS, z: h.site.z },
    carrier: NO_CARRIER,
    pickedUp: false,
    signedOut: false,
  }));
  world.interactables.set(BOX_INTERACTABLE_ID, {
    id: BOX_INTERACTABLE_ID,
    pos: cloneVec3(register.box),
    radius: BOX_RADIUS,
    kind: InteractKind.Register,
    label: "Read the register",
    // Reading is the client's own screen and signing out is a hold
    // (`stepRegister`), so a press on the box does nothing in the world.
    onInteract: () => undefined,
  });
  for (const item of world.state.items) {
    const hiker = register.hikers[item.id] as Hiker;
    world.interactables.set(ITEM_INTERACTABLE_BASE + item.id, {
      id: ITEM_INTERACTABLE_BASE + item.id,
      pos: cloneVec3(item.pos),
      radius: ITEM_RADIUS,
      kind: InteractKind.Item,
      label: `Pick up ${hiker.name}`,
      enabled: true,
      onInteract: (playerId) => pickUp(world, playerId, item.id),
    });
  }
  syncItemInteractables(world);
}

/** The interactables follow the items: position, and whether anyone can reach for them. */
export function syncItemInteractables(world: World): void {
  for (const item of world.state.items) {
    const it = world.interactables.get(ITEM_INTERACTABLE_BASE + item.id);
    if (it === undefined) continue;
    it.pos.x = item.pos.x;
    it.pos.y = item.pos.y;
    it.pos.z = item.pos.z;
    it.enabled = item.carrier === NO_CARRIER && !item.signedOut;
  }
}

/** `isDead` without importing world.ts, which imports this module. */
function dead(p: PlayerState): boolean {
  return p.health <= 0;
}

/**
 * An Interact press on an item in reach. Empty hands only, one item at a
 * time; the first pick-up of a hiker is what raises the escalation count,
 * and a second never adds to it.
 */
export function pickUp(world: World, playerId: number, itemId: number): void {
  const player = world.state.players.get(playerId);
  const item = world.state.items[itemId];
  if (player === undefined || item === undefined) return;
  if (dead(player) || player.carrying !== NO_ITEM) return;
  if (item.carrier !== NO_CARRIER || item.signedOut) return;
  item.carrier = playerId;
  item.pickedUp = true;
  player.carrying = itemId;
  player.signOutTicks = 0;
}

/** Sets the carried item down at the player's feet — on a press with nothing in reach, and on death. */
export function putDown(world: World, player: PlayerState): void {
  if (player.carrying === NO_ITEM) return;
  const item = world.state.items[player.carrying];
  player.carrying = NO_ITEM;
  player.signOutTicks = 0;
  if (item === undefined) return;
  item.carrier = NO_CARRIER;
  item.pos = { x: player.pos.x, y: player.pos.y - PLAYER_HALF.y + ITEM_RADIUS, z: player.pos.z };
}

function signOut(world: World, player: PlayerState): void {
  const item = world.state.items[player.carrying];
  player.carrying = NO_ITEM;
  player.signOutTicks = 0;
  if (item === undefined) return;
  item.carrier = NO_CARRIER;
  item.signedOut = true;
}

/**
 * The per-tick rules, host only (`tickWorld` calls this in its authoritative
 * branch): the sign-out hold, the item interactables, and the win.
 *
 * The hold is read from this tick's command rather than from press edges: a
 * hold is a level, and it breaks the tick the level drops, the tick the box
 * leaves reach, and the tick the player dies or empties their hands.
 */
export function stepRegister(world: World, inputs: ReadonlyMap<number, InputCommand>): void {
  if (world.register === null) return;
  for (const player of world.state.players.values()) {
    if (player.carrying === NO_ITEM || dead(player)) {
      player.signOutTicks = 0;
      continue;
    }
    const cmd = inputs.get(player.id);
    const held = cmd !== undefined && (cmd.buttons & Button.Interact) !== 0;
    const target = held ? resolveInteract(world, player) : null;
    if (target === null || target.kind !== InteractKind.Register) {
      player.signOutTicks = 0;
      continue;
    }
    player.signOutTicks++;
    if (player.signOutTicks >= SIGN_OUT_TICKS) signOut(world, player);
  }
  syncItemInteractables(world);
  updateOutcome(world);
}

/** Every hiker signed out, and every living player within CAR_RADIUS of the car. */
function updateOutcome(world: World): void {
  const register = world.register;
  const state = world.state;
  if (register === null || state.outcome !== Outcome.Playing) return;
  if (state.items.length === 0 || !state.items.every((it) => it.signedOut)) return;
  let living = 0;
  for (const p of state.players.values()) {
    if (dead(p)) continue;
    living++;
    const dx = p.pos.x - register.car.x;
    const dz = p.pos.z - register.car.z;
    if (dx * dx + dz * dz > CAR_RADIUS * CAR_RADIUS) return;
  }
  if (living === 0) return;
  state.outcome = Outcome.Won;
}

/** Hikers picked up at least once: the escalation count (D reads this). */
export function retrievedCount(state: WorldState): number {
  let n = 0;
  for (const it of state.items) if (it.pickedUp) n++;
  return n;
}

export function signedOutCount(state: WorldState): number {
  let n = 0;
  for (const it of state.items) if (it.signedOut) n++;
  return n;
}
