/**
 * Where a player is, by city: the telemetry route hands a new session's
 * address to csarko.sh's analytics collector (lib-visits), whose `POST /place`
 * looks it up in the city database bundled there and answers the country, the
 * region, the city and the city's coordinates (to a tenth of a degree), never
 * keeping the address (lib-visits' SPEC section 7).
 * This service holds no database of its own and writes no address: only the
 * place, on one `geo` row a session (`telemetry.ts`; not `place`, which is the game's own event
 * for a named place on the trail).
 *
 * Configured by `PLACE_URL` (the collector's route) and `PLACE_TOKEN` (its
 * bearer token); without both, nothing is placed. A lookup that fails or
 * takes longer than `timeoutMs` places nothing, so a slow collector never
 * holds a batch.
 */

export type Place = { cc?: string; rg?: string; ct?: string; la?: number; lo?: number };
export type Placer = (ip: string) => Promise<Place | null>;

const KEYS = ["cc", "rg", "ct"] as const;

/** The collector's answer, kept only where each value is a short string. */
export function placeOf(body: unknown): Place | null {
  if (typeof body !== "object" || body === null) return null;
  const out: Place = {};
  for (const key of KEYS) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0 && v.length <= 64) out[key] = v;
  }
  // The city's coordinates, a tenth of a degree as the collector rounds them; anything else is dropped.
  const la = (body as Record<string, unknown>).la;
  const lo = (body as Record<string, unknown>).lo;
  if (typeof la === "number" && typeof lo === "number" && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
    out.la = Math.round(la * 10) / 10;
    out.lo = Math.round(lo * 10) / 10;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function createPlacer(options: { url: string; token: string; timeoutMs?: number; fetch?: typeof fetch }): Placer {
  const get = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  return async (ip) => {
    try {
      const res = await get(options.url, {
        method: "POST",
        headers: { authorization: `Bearer ${options.token}`, "content-type": "text/plain" },
        body: ip,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      return placeOf(await res.json());
    } catch {
      return null;
    }
  };
}

/**
 * The sessions already placed, so each is looked up once: the newest
 * `capacity` kept, the oldest forgotten first. A session placed again after
 * it was forgotten, or on another instance, writes a second row, which the
 * queries read as the same place.
 */
export class PlacedSessions {
  private readonly seen = new Set<string>();
  constructor(private readonly capacity = 10_000) {}
  /** True the first time `sid` is offered, false after. */
  first(sid: string): boolean {
    if (this.seen.has(sid)) return false;
    this.seen.add(sid);
    if (this.seen.size > this.capacity) this.seen.delete(this.seen.values().next().value as string);
    return true;
  }
}
