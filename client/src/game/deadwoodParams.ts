/**
 * The dead trees' dressing (`lite/forestPlugins.ts`): the one model `deadwood.snag`
 * wears, lying as a fallen log and stood up as a snag, draws its bark from a
 * trunk bark set projected along its trunk instead of its file's one small
 * map, carries the trunks' moss on a log's upper side and down a snag's one
 * side, and darkens where a log's underside meets the floor. Babylon-free: the
 * plugin's WGSL is written with the constants here.
 */
import { BARK_FOOTPRINT, type BarkDressing } from "./barkParams.js";

/** The set the dead trees wear: the fir's pine set at its full size on the
 * high tier, its repeats 1 because the plugin lays the coordinates itself. */
export const DEADWOOD_BARK: BarkDressing = { set: "pine", along: "v", alongRepeat: 1, roundRepeat: 1, fine: true };
/** The trunk's radius in the model (m at scale 1), under its root flare, and
 * where its axis runs through the model's y and z: the bark is laid round it. */
export const DEADWOOD_RADIUS = 0.3;
export const DEADWOOD_AXIS: { readonly y: number; readonly z: number } = { y: 0.2, z: 0.03 };
/** A log's moss: on the upper side, by the world normal's rise, from none
 * below the first to all above the second. */
export const DEADWOOD_UP: readonly [number, number] = [-0.1, 0.55];
/** The least of the moss draw a log takes (the share of `MOSS_AMOUNT`'s
 * range its hash maps onto, from here to all): a trunk lying on the wet floor
 * is mossier than any standing one. */
export const DEADWOOD_LOG_DRAW = 0.7;
/** What a dead trunk's bark set is multiplied by in place of `BARK_TONE`,
 * linear: weathered, greyed and darkened under a living trunk's, the blue
 * held over the red, so a log reads as dead wood and not a felled pine. */
export const DEADWOOD_TONE: { readonly r: number; readonly g: number; readonly b: number } = { r: 0.5, g: 0.5, b: 0.53 };
/** The contact band under a log: its albedo taken to this share at the
 * underside, back to itself across the band of the model's own y (m at
 * scale 1), from under the root flare to over the trunk's seat line. */
export const DEADWOOD_CONTACT = 0.55;
export const DEADWOOD_CONTACT_BAND: readonly [number, number] = [-0.35, 0.15];

/** The dead trees' uniforms by name: the bark's lay (the set's repeats a
 * metre along the trunk and round it, the trunk's radius, the snag's base
 * along the model's x) and where the trunk's axis runs through the model's
 * y and z. */
export type DeadwoodUniforms = { deadwoodBark: [number, number, number, number]; deadwoodAxis: [number, number] };

/** A record of the right shape, every component zero. */
export function emptyDeadwoodUniforms(): DeadwoodUniforms {
  return { deadwoodBark: [0, 0, 0, 0], deadwoodAxis: [0, 0] };
}

/**
 * The uniforms the dead trees' material is drawn with, into `out`. `base` is
 * the snag's base along the model's x (m at scale 1), measured from the
 * loaded geometry: the height a snag's moss band reads from.
 */
export function deadwoodUniforms(base: number, out: DeadwoodUniforms): DeadwoodUniforms {
  const footprint = BARK_FOOTPRINT[DEADWOOD_BARK.set];
  out.deadwoodBark[0] = 1 / footprint.height;
  out.deadwoodBark[1] = 1 / footprint.width;
  out.deadwoodBark[2] = DEADWOOD_RADIUS;
  out.deadwoodBark[3] = base;
  out.deadwoodAxis[0] = DEADWOOD_AXIS.y;
  out.deadwoodAxis[1] = DEADWOOD_AXIS.z;
  return out;
}
