/**
 * The wear on a fork sign's painted name: faded, uneven ink with flakes,
 * chips and grain-wise scratches knocked out of it, and a letter or two gone
 * fainter than the rest. Every choice comes from a small generator seeded by
 * the name itself, so each peer sees the same wear on the same name, and the
 * whole of it is plain numbers the canvas painter (`paintedLabel`) applies.
 */

/** Where the painted name's ink lies in the texture, in pixels, y down. */
export type InkBox = { x: number; y: number; width: number; height: number };

export type LabelWear = {
  /** The whole name's ink opacity: faded, never gone. */
  alpha: number;
  /** One opacity multiplier per character (code point) of the name, a letter or two well under the rest. */
  letters: number[];
  /** Soft patches where the ink has faded unevenly: `strength` of it rubbed away at the centre, none at the rim. */
  patches: { x: number; y: number; r: number; strength: number }[];
  /** Small flakes of paint gone. */
  specks: { x: number; y: number; r: number }[];
  /** A few larger, ragged chips gone: closed outlines. */
  chips: { points: { x: number; y: number }[] }[];
  /** Scratches along the grain (the board's length, the texture's x). */
  scratches: { x0: number; y0: number; x1: number; y1: number; width: number }[];
};

/** The knocked-out share of the ink box is held under this. */
export const WEAR_AREA_CAP = 0.12;
/** The overall opacity lies in this range: faded, still dark enough to read. */
export const WEAR_ALPHA = { min: 0.78, max: 0.9 } as const;
/** A faint letter keeps at least this share of the rest's ink. */
export const FAINT_LETTER_MIN = 0.5;

/** FNV-1a over the name's UTF-16 code units. */
export function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small, fast generator of floats in [0, 1). */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The area of a closed outline (shoelace). */
export function outlineArea(points: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as { x: number; y: number };
    const b = points[(i + 1) % points.length] as { x: number; y: number };
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** How much of the ink box the specks, chips and scratches knock out, at most (overlaps counted twice). */
export function knockedOutArea(wear: LabelWear): number {
  let area = 0;
  for (const s of wear.specks) area += Math.PI * s.r * s.r;
  for (const c of wear.chips) area += outlineArea(c.points);
  for (const s of wear.scratches) area += Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * s.width;
  return area;
}

/**
 * The wear for one name painted into `ink`. Sizes scale with the ink's
 * height, every mark lies inside the box, and the knocked-out area stays
 * under `WEAR_AREA_CAP` of it, so the name still reads.
 */
export function labelWear(name: string, ink: InkBox): LabelWear {
  const rand = generator(nameHash(name));
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();
  const h = ink.height;
  const cap = WEAR_AREA_CAP * ink.width * ink.height;
  let used = 0;
  /** A point at least `pad` inside the box. */
  const inside = (pad: number): { x: number; y: number } => ({
    x: ink.x + pad + rand() * Math.max(0, ink.width - 2 * pad),
    y: ink.y + pad + rand() * Math.max(0, ink.height - 2 * pad),
  });

  const alpha = between(WEAR_ALPHA.min, WEAR_ALPHA.max);

  // Every letter a little uneven; one or two (of those that are not spaces) well under the rest.
  const chars = Array.from(name);
  const letters = chars.map(() => between(0.86, 1));
  const inked = [...letters.keys()].filter((i) => chars[i] !== " ");
  const faint = inked.length > 3 ? 1 + Math.floor(rand() * 2) : Math.min(1, inked.length);
  for (let k = 0; k < faint; k++) {
    const pick = inked.splice(Math.floor(rand() * inked.length), 1)[0] as number;
    letters[pick] = between(FAINT_LETTER_MIN, 0.68);
  }

  const patches: LabelWear["patches"] = [];
  const patchCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < patchCount; i++) {
    const r = between(0.25, 0.5) * h;
    patches.push({ ...inside(r), r, strength: between(0.15, 0.35) });
  }

  // Knock-outs, largest first, each kept only while the total stays under the cap.
  const chips: LabelWear["chips"] = [];
  const chipCount = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < chipCount; i++) {
    const r = between(0.04, 0.08) * h;
    const at = inside(r * 1.3);
    const sides = 5 + Math.floor(rand() * 3);
    const turn = rand() * 2 * Math.PI;
    const points: { x: number; y: number }[] = [];
    for (let k = 0; k < sides; k++) {
      const angle = turn + (2 * Math.PI * k) / sides;
      const reach = r * between(0.55, 1.3);
      points.push({ x: at.x + reach * Math.cos(angle), y: at.y + reach * Math.sin(angle) });
    }
    const area = outlineArea(points);
    if (used + area > cap) continue;
    used += area;
    chips.push({ points });
  }

  const scratches: LabelWear["scratches"] = [];
  const scratchCount = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < scratchCount; i++) {
    const length = between(0.15, 0.35) * ink.width;
    const width = between(0.008, 0.014) * h;
    const x0 = ink.x + rand() * Math.max(0, ink.width - length);
    // Along the grain: a slight slope, both ends inside the box.
    const y0 = ink.y + between(0.15, 0.85) * ink.height;
    const drift = between(-0.04, 0.04) * length;
    const y1 = Math.min(ink.y + ink.height, Math.max(ink.y, y0 + drift));
    const area = Math.hypot(length, y1 - y0) * width;
    if (used + area > cap) continue;
    used += area;
    scratches.push({ x0, y0, x1: x0 + length, y1, width });
  }

  const specks: LabelWear["specks"] = [];
  const speckCount = 24 + Math.floor(rand() * 22);
  for (let i = 0; i < speckCount; i++) {
    const r = between(0.006, 0.018) * h;
    const area = Math.PI * r * r;
    const at = inside(r);
    if (used + area > cap) continue;
    used += area;
    specks.push({ ...at, r });
  }

  return { alpha, letters, patches, specks, chips, scratches };
}
