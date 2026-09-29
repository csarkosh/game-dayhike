/**
 * The wear on the trailhead board's sheets: a water stain, a sun-bleached
 * corner, rust under each staple and the print faded in patches. Every
 * choice comes from a generator seeded by the world's seed and the sheet's
 * name, so each peer sees the same marks, and all of it is plain numbers the
 * painter applies. The routed lines across the top wear as the fork signs'
 * lettering does (`labelWear`).
 */
import { nameHash, wearGenerator } from "./labelWear.js";
import type { Rect } from "./boardFace.js";

export type SheetWear = {
  /** A water stain: a soft brown patch, its centre and radius in the sheet's own pixels. */
  stain: { x: number; y: number; r: number; strength: number };
  /** The corner the sun has bleached, counted clockwise from the top-left, and how far it reaches. */
  bleach: { corner: 0 | 1 | 2 | 3; r: number; strength: number };
  /** Rust under each staple, clockwise from the top-left: how dark, and how far it has run down the sheet. */
  rust: { strength: number; run: number }[];
  /** Patches where what is printed has faded: `strength` of it gone at the centre, none at the rim. */
  fades: { x: number; y: number; r: number; strength: number }[];
  /** How much of the print's strength is left over the whole sheet. */
  ink: number;
};

/** The print keeps this much of its strength at the least: faded, still read. */
export const SHEET_INK = { min: 0.62, max: 0.8 } as const;

/** The wear of one sheet of a world's board. Every mark lies inside the sheet. */
export function sheetWear(worldSeed: number, name: string, rect: Pick<Rect, "width" | "height">): SheetWear {
  const rand = wearGenerator((nameHash(name) ^ worldSeed) >>> 0);
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();
  const short = Math.min(rect.width, rect.height);
  const stainR = between(0.18, 0.32) * short;
  const stain = {
    x: between(stainR, rect.width - stainR),
    // Low on the sheet, where water gathers, and wholly inside it.
    y: between(Math.max(stainR, 0.45 * rect.height), rect.height - stainR),
    r: stainR,
    strength: between(0.18, 0.34),
  };
  const bleach = {
    corner: Math.floor(rand() * 4) as 0 | 1 | 2 | 3,
    r: between(0.35, 0.6) * short,
    strength: between(0.2, 0.4),
  };
  const rust = [0, 1, 2, 3].map(() => ({ strength: between(0.25, 0.6), run: between(0.02, 0.07) * rect.height }));
  const fades: SheetWear["fades"] = [];
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const r = between(0.12, 0.28) * short;
    fades.push({ x: between(r, rect.width - r), y: between(r, rect.height - r), r, strength: between(0.2, 0.45) });
  }
  return { stain, bleach, rust, fades, ink: between(SHEET_INK.min, SHEET_INK.max) };
}
