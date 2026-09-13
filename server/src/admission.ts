/**
 * Who is allowed to open a signaling socket, and how many at a time.
 *
 * The upgrade handler in `server.ts` is public and unauthenticated — there is
 * no account system and a room id is the only secret — so the checks here are
 * the whole of the front door. They are deliberately coarse: none of them can
 * stop a determined attacker, and pretending otherwise would be worse than
 * knowing they are a filter for casual abuse and accidents.
 */

/**
 * Origins the browser build is actually served from. Firebase provisions the
 * two default hostnames alongside the custom domain and all three serve the
 * same bundle, so a player who reaches the game by any of them must be able to
 * signal. `localhost:5173` is Vite: in development the page and the socket
 * share that origin because Vite proxies `/ws` through to this server, so what
 * arrives here is the dev server's origin rather than `localhost:8080`.
 * The desktop shell (`desktop/main.cjs`) loads the site itself, so its origin is the first entry.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://games.csarko.sh",
  // game.csarko.sh now serves only the redirect page, so nothing new opens a
  // socket from it. It stays listed for web tabs still holding the old bundle
  // at the old origin and can go at a later server deploy.
  "https://game.csarko.sh",
  "https://fps-csarko.web.app",
  "https://fps-csarko.firebaseapp.com",
  "http://localhost:5173",
  "https://localhost:5173",
];

/**
 * A missing `Origin` is allowed; a present but unlisted one is not.
 *
 * That asymmetry is the point. Browsers set this header on every WebSocket
 * handshake and refuse to let page script forge it, so the check does the one
 * job it can do honestly: stop someone else's web page from pointing its
 * players at this server. Anything that is not a browser — the test suite, a
 * probe, an attacker with a socket library — can send whatever origin it likes
 * or none at all, so refusing an absent header would break the legitimate
 * non-browser callers while stopping nobody. A sandboxed iframe sends the
 * literal string `null`, which is present and unlisted, so it is refused.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined) return true;
  return allowed.includes(origin);
}

/**
 * The caller's address, as well as it can be known.
 *
 * On Cloud Run every connection arrives from Google's frontend, so
 * `remoteAddress` is the same value for every player on earth and is useless
 * as a key — `X-Forwarded-For` is the only thing that distinguishes them, and
 * its leftmost entry is the original client. It is also trivially spoofable by
 * a non-browser client, which is why nothing here is a security boundary on
 * its own; see `ConnectionLimiter` for what bounds the damage instead.
 */
export function clientIpOf(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined,
): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const first = header?.split(",")[0]?.trim();
  if (first !== undefined && first !== "") return first;
  return remoteAddress ?? "unknown";
}

export type Admission =
  | { ok: true; release(): void }
  | { ok: false; code: "too_many_connections" | "too_many_attempts" };

export type ConnectionLimiterOptions = {
  /** Sockets one address may hold open at once. */
  maxPerIp?: number;
  /** Sockets one address may open within a window, however briefly. */
  maxAttemptsPerWindow?: number;
  /** Length of that window. */
  windowMs?: number;
  /** Hard ceiling on how many addresses are tracked at once. */
  maxTrackedIps?: number;
  /** Injected clock, for tests. */
  now?: () => number;
};

type Entry = { live: number; windowStart: number; attempts: number };

/** Admitted without being tracked, once the address table is full. */
const UNTRACKED: Admission = { ok: true, release: () => undefined };

/**
 * Two limits per address: how many sockets it holds at once, and how many it
 * opens per window. The first bounds what one client can occupy; the second
 * bounds what it can churn through, which the first alone does not.
 *
 * **Memory is the constraint that shapes this class.** It keys on an address
 * derived from a header a client controls, so a flood of forged addresses is
 * the obvious attack on the limiter itself — and this process is a single
 * 512 MiB instance holding every live room, so exhausting its heap is a worse
 * outcome than whatever the limiter was going to prevent. Hence `maxTrackedIps`:
 * once the table is full, further unknown addresses are admitted untracked
 * rather than allocating, so the failure mode under a spoofing flood is that
 * per-address limits stop applying — not an OOM, and not a lockout of the
 * players already in the table. What still holds in that state is Cloud Run's
 * own concurrency ceiling, which caps this instance at 250 simultaneous
 * requests no matter what any header says.
 *
 * Only admitted connections count toward the attempt limit. Counting refusals
 * would let a client extend its own penalty indefinitely by continuing to
 * hammer, which for a shared NAT means one bad actor locking out a household.
 */
export class ConnectionLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxPerIp: number;
  private readonly maxAttemptsPerWindow: number;
  private readonly windowMs: number;
  private readonly maxTrackedIps: number;
  private readonly now: () => number;

  constructor(options: ConnectionLimiterOptions = {}) {
    // A household can legitimately fill a room (`MAX_PEERS`) from one address,
    // and a reconnect briefly overlaps the socket it replaces, so the per-address
    // ceiling has to sit well above the room size to avoid refusing real players.
    this.maxPerIp = options.maxPerIp ?? 16;
    this.maxAttemptsPerWindow = options.maxAttemptsPerWindow ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxTrackedIps = options.maxTrackedIps ?? 4096;
    this.now = options.now ?? (() => Date.now());
  }

  /** How many addresses are currently held. Bounded by `maxTrackedIps`. */
  get tracked(): number {
    return this.entries.size;
  }

  /**
   * Decide on one connection. On success the caller must invoke `release` when
   * the socket closes, or the address leaks a slot for the life of the process.
   */
  admit(ip: string): Admission {
    const now = this.now();
    let entry = this.entries.get(ip);

    if (entry === undefined) {
      if (this.entries.size >= this.maxTrackedIps) return UNTRACKED;
      entry = { live: 0, windowStart: now, attempts: 0 };
      this.entries.set(ip, entry);
    }

    if (now - entry.windowStart >= this.windowMs) {
      entry.windowStart = now;
      entry.attempts = 0;
    }

    if (entry.live >= this.maxPerIp) return { ok: false, code: "too_many_connections" };
    if (entry.attempts >= this.maxAttemptsPerWindow) {
      return { ok: false, code: "too_many_attempts" };
    }

    entry.live += 1;
    entry.attempts += 1;

    const held = entry;
    let released = false;
    return {
      ok: true,
      release: () => {
        // A socket can emit close more than once; releasing twice would free a
        // slot the address never held.
        if (released) return;
        released = true;
        held.live = Math.max(0, held.live - 1);
      },
    };
  }

  /**
   * Drop addresses holding nothing whose window has passed. An entry with a
   * live socket is never dropped, which is what makes the `release` closure's
   * captured entry safe to mutate later.
   */
  prune(): void {
    const now = this.now();
    for (const [ip, entry] of this.entries) {
      if (entry.live > 0) continue;
      if (now - entry.windowStart < this.windowMs) continue;
      this.entries.delete(ip);
    }
  }
}
