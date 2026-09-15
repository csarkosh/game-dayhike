import { nextRandom } from "./types.js";

/**
 * The missing hikers' names, drawn from two fixed tables by the world seed so
 * every peer reads the same book. Plain, period-neutral names: the register is
 * a real trailhead's, not a horror prop.
 */
export const FIRST_NAMES: readonly string[] = [
  "Dana", "Ruth", "Owen", "Miles", "Clara", "Elias", "June", "Theo", "Nora", "Hugh",
  "Iris", "Silas", "Mara", "Reuben", "Tessa", "Abel", "Wren", "Cyrus", "Lena", "Jonah",
  "Ada", "Felix", "Greta", "Amos", "Ines", "Rafe", "Sylvie", "Boyd", "Edith", "Callum",
  "Maeve", "Ansel",
];
export const LAST_NAMES: readonly string[] = [
  "Whitcombe", "Harlan", "Petersen", "Okafor", "Lindqvist", "Marsh", "Delacroix", "Reyes",
  "Thornbury", "Kowalski", "Abernathy", "Nakamura", "Fenwick", "Oyelaran", "Castellano", "Brandt",
  "Halvorsen", "Mbeki", "Ashdown", "Ferreira", "Quennell", "Tanaka", "Voss", "Ellery",
  "Ibarra", "Rostova", "Gallagher", "Sato", "Whitlock", "Duran", "Kessler", "Pryor",
];

const NAME_SALT = 0x4e414d45;

/** `count` names, first and last, no surname repeated. Deterministic in `seed`. */
export function hikerNames(seed: number, count: number): string[] {
  const rng = { rngSeed: (seed ^ NAME_SALT) | 0 };
  const lasts = [...LAST_NAMES];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[Math.floor(nextRandom(rng) * FIRST_NAMES.length)] as string;
    const at = Math.floor(nextRandom(rng) * lasts.length);
    const last = lasts.splice(at, 1)[0] as string;
    out.push(`${first} ${last}`);
  }
  return out;
}
