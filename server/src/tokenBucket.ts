/**
 * A token bucket: `capacity` tokens, refilling at `refillPerSecond`.
 *
 * Refill is lazy — computed from elapsed time on each attempt rather than
 * driven by a timer — so a bucket costs nothing while its socket is idle, and
 * a server holding hundreds of them holds no timers at all. It also keeps the
 * class deterministic under an injected clock, which is how `RoomRegistry`
 * and `ConnectionLimiter` are already built and tested.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    // Starting full is what makes the capacity a burst allowance: a client
    // that connects and immediately exchanges a flurry of ICE candidates is
    // spending a budget that accrued before it arrived.
    this.tokens = capacity;
    this.lastRefill = now();
  }

  /** Remaining budget. Exposed for tests and diagnostics, not for decisions. */
  get available(): number {
    return this.tokens;
  }

  /**
   * Spends one token if there is one. Returns false when the budget is gone,
   * which is the caller's signal that this sender is over its rate.
   */
  tryConsume(): boolean {
    const now = this.now();
    const elapsedMs = now - this.lastRefill;

    // A clock that goes backwards must not mint tokens.
    if (elapsedMs > 0) {
      this.tokens = Math.min(
        this.capacity,
        this.tokens + (elapsedMs / 1000) * this.refillPerSecond,
      );
      this.lastRefill = now;
    }

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
