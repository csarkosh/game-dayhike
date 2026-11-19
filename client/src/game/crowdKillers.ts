/**
 * The chase's killers among the crowd (docs/gameplay/2026-11-13-the-way-down.md):
 * while the crowd is up, what can kill (the Hollow that hunts, a lunge, a
 * strike) is drawn as the crowd is drawn, a dark figure in the mist that
 * glides, and not as the model that walks. It is one of the shadows, told
 * from them by its eyes: the Hollow's red, where the crowd's are never red
 * (crowdEyes.ts), and by a body that is solid where theirs are veils
 * (crowdCards.ts). This file turns the frame's bodies into figures of the
 * crowd's kind, with no engine; the renderer draws them with the crowd.
 */
import { CROWD_FADE_S, CROWD_RISE_S, type CrowdFigure } from "./crowdField.js";

/** A killer's size as a share of a Hollow's, and the most of them a frame draws beside the crowd. */
export const KILLER_SIZE = 1.15;
export const KILLERS_MOST = 12;

/** A body of the frame as this file reads it (entityPoses.ts `HollowPose`): where it is drawn, how far in it is, whether it is drawn as a shadow, and how far its arms are out (a lunge's last metres, a strike). */
export type KillerPose = { readonly id: number; readonly x: number; readonly z: number; readonly level: number; readonly shadow: boolean; readonly reach: number };

export type KillerShadows = {
  /**
   * A frame's bodies at the screen's `seconds`: each drawn as a shadow has
   * its figure where it stands, as far in as its body is; one no longer
   * among them goes over the crowd's fade and is then forgotten.
   */
  step(poses: readonly KillerPose[], seconds: number): void;
  /** The killers' figures and then `crowd`'s, as one list (reused): the killers first, so a full crowd never leaves one out. */
  shown(crowd: readonly CrowdFigure[]): readonly CrowdFigure[];
  /** Forgets every one. */
  clear(): void;
};

export function createKillerShadows(): KillerShadows {
  const figures = new Map<number, CrowdFigure>();
  const live = new Set<number>();
  const out: CrowdFigure[] = [];
  return {
    step(poses, seconds) {
      live.clear();
      for (const pose of poses) {
        if (!pose.shadow) continue;
        live.add(pose.id);
        let f = figures.get(pose.id);
        if (f === undefined || f.gone >= 0) {
          // Numbered below nothing: the crowd's own count up from 1.
          f = { id: -(pose.id + 1), x: pose.x, z: pose.z, size: KILLER_SIZE, eyes: 1, warm: 1, pace: 1, born: seconds - pose.level * CROWD_RISE_S, gone: -1, rise: 0, kills: true };
          figures.set(pose.id, f);
        }
        f.x = pose.x;
        f.z = pose.z;
        f.reach = pose.reach;
      }
      for (const [id, f] of figures) {
        if (live.has(id)) continue;
        if (f.gone < 0) f.gone = seconds;
        else if (seconds - f.gone >= CROWD_FADE_S) figures.delete(id);
      }
    },
    shown(crowd) {
      out.length = 0;
      for (const f of figures.values()) out.push(f);
      for (const f of crowd) out.push(f);
      return out;
    },
    clear() {
      figures.clear();
    },
  };
}
