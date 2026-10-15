/**
 * Who is allowed to open a signaling socket, and how many at a time; and,
 * for the telemetry route, whose batches are to be dropped (`parseIpRanges`).
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
  // The admin page (`client/src/admin/`) is served from the shared admin host
  // (csarko.sh's `admin/`) and reads this server's `/admin/*` routes
  // cross-origin, so its origin has to be here for the routes' CORS check
  // (`admin.ts` reads this same list); the bearer token it sends makes the
  // browser preflight each request. The second is that shell's local preview,
  // so the page can be worked on against production. Neither opens a socket.
  "https://admin.csarko.sh",
  "http://localhost:8788",
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

/**
 * An address range, for the telemetry route's ignore list: a network and a
 * prefix length, both in the 128-bit space IPv6 and IPv4 share. An IPv4
 * address is held as its mapped form (`::ffff:a.b.c.d`) and an IPv4 prefix
 * is lengthened by 96 to match, so one comparison serves both families and
 * a v4-mapped address, as a proxy may forward one, matches its v4 range.
 */
export type IpRange = { readonly net: bigint; readonly prefix: number };

const IPV4_BITS = 32;
const IPV6_BITS = 128;
/** The mapped block, `::ffff:0:0/96`: where an IPv4 address sits in 128 bits. */
const V4_MAPPED = 0xffffn << 32n;

function parseIpv4(text: string): bigint | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (match === null) return null;
  let out = 0n;
  for (const octet of match.slice(1)) {
    const n = Number(octet);
    if (n > 255) return null;
    out = (out << 8n) | BigInt(n);
  }
  return out;
}

/** The address as 128 bits, an IPv4 one mapped; null for what is neither. */
function parseIpv6(text: string): bigint | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(":")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0] ?? "");
  const tail = halves.length === 2 ? groups(halves[1] ?? "") : [];
  // A dotted IPv4 tail, as `::ffff:203.0.113.7` has, is its last two groups.
  const last = tail.length > 0 ? tail : head;
  const dotted = last[last.length - 1];
  if (dotted !== undefined && dotted.includes(".")) {
    const v4 = parseIpv4(dotted);
    if (v4 === null) return null;
    last.splice(-1, 1, (v4 >> 16n).toString(16), (v4 & 0xffffn).toString(16));
  }
  const given = head.length + tail.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return null;
  const words = [...head, ...new Array<string>(8 - given).fill("0"), ...tail];
  let out = 0n;
  for (const word of words) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(word)) return null;
    out = (out << 16n) | BigInt(parseInt(word, 16));
  }
  return out;
}

/** An address of either family as 128 bits, or null. */
function parseIp(text: string): { bits: bigint; family: 4 | 6 } | null {
  const v4 = parseIpv4(text);
  if (v4 !== null) return { bits: V4_MAPPED | v4, family: 4 };
  const v6 = parseIpv6(text);
  return v6 === null ? null : { bits: v6, family: 6 };
}

/**
 * The ignore list from its environment variable: addresses or CIDR prefixes
 * of either family, comma-separated, blanks skipped. A bad entry throws,
 * naming itself, so the process fails to start rather than quietly counting
 * what it was told to leave out.
 */
export function parseIpRanges(text: string | undefined): IpRange[] {
  const ranges: IpRange[] = [];
  for (const entry of (text ?? "").split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const [address, prefixText, ...rest] = trimmed.split("/");
    const ip = address === undefined ? null : parseIp(address);
    if (ip === null || rest.length > 0) throw new Error(`not an IP address or CIDR prefix: "${trimmed}"`);
    const width = ip.family === 4 ? IPV4_BITS : IPV6_BITS;
    const prefixOwn = prefixText === undefined ? width : /^\d{1,3}$/.test(prefixText) ? Number(prefixText) : -1;
    if (prefixOwn < 0 || prefixOwn > width) throw new Error(`not an IP address or CIDR prefix: "${trimmed}"`);
    const prefix = prefixOwn + (IPV6_BITS - width);
    // Masked to its network, so the host bits an entry carries do not matter.
    const shift = BigInt(IPV6_BITS - prefix);
    ranges.push({ net: (ip.bits >> shift) << shift, prefix });
  }
  return ranges;
}

/** Whether `ip` (as `clientIpOf` gives it) lies in any of `ranges`. An address that does not parse is in none. */
export function ipInRanges(ip: string, ranges: readonly IpRange[]): boolean {
  if (ranges.length === 0) return false;
  const parsed = parseIp(ip);
  if (parsed === null) return false;
  return ranges.some((range) => {
    const shift = BigInt(IPV6_BITS - range.prefix);
    return parsed.bits >> shift === range.net >> shift;
  });
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

/**
 * Whether any address the request names is in `ranges`: every X-Forwarded-For
 * entry and the socket's own. The ignore list is for the owner's own machines,
 * and behind a proxy or VPN of their own the owner's address is not the first
 * entry; nothing is lost by reading them all, since a forged entry can only
 * get a stranger ignored, never un-ignore the owner.
 */
export function anyIpInRanges(forwardedFor: string | string[] | undefined, remoteAddress: string | undefined, ranges: readonly IpRange[]): boolean {
  if (ranges.length === 0) return false;
  const headers = Array.isArray(forwardedFor) ? forwardedFor : forwardedFor === undefined ? [] : [forwardedFor];
  const entries = headers.flatMap((h) => h.split(",")).map((e) => e.trim()).filter((e) => e !== "");
  if (remoteAddress !== undefined && remoteAddress !== "") entries.push(remoteAddress);
  return entries.some((ip) => ipInRanges(ip, ranges));
}
