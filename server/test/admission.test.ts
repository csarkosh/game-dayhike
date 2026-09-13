import { describe, it, expect } from "vitest";
import {
  clientIpOf,
  ConnectionLimiter,
  DEFAULT_ALLOWED_ORIGINS,
  isAllowedOrigin,
} from "../src/admission.js";

describe("isAllowedOrigin", () => {
  it("admits an origin on the list", () => {
    expect(isAllowedOrigin("https://game.csarko.sh", DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it("admits the new site host and keeps the old one through the transition", () => {
    expect(isAllowedOrigin("https://games.csarko.sh", DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin("https://game.csarko.sh", DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it("admits the Vite dev origin, which is the page's origin in development", () => {
    expect(isAllowedOrigin("http://localhost:5173", DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it("refuses another site's page", () => {
    expect(isAllowedOrigin("https://evil.example", DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });

  it("refuses a sandboxed iframe, which sends the literal string null", () => {
    expect(isAllowedOrigin("null", DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });

  it("admits a request with no Origin at all", () => {
    // Non-browser callers — the test suite, probes — send none, and refusing
    // them would stop nothing, since anything not a browser can forge one.
    expect(isAllowedOrigin(undefined, DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it("does not admit an origin that merely contains an allowed one", () => {
    expect(isAllowedOrigin("https://game.csarko.sh.evil.example", DEFAULT_ALLOWED_ORIGINS)).toBe(
      false,
    );
  });

  it("no longer admits app://fps — the shell loads the site now", () => {
    expect(isAllowedOrigin("app://fps", DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });
});

describe("clientIpOf", () => {
  it("takes the leftmost forwarded address", () => {
    expect(clientIpOf("203.0.113.7, 130.211.0.1", "169.254.1.1")).toBe("203.0.113.7");
  });

  it("handles a repeated header, which node surfaces as an array", () => {
    expect(clientIpOf(["203.0.113.7", "198.51.100.2"], "169.254.1.1")).toBe("203.0.113.7");
  });

  it("falls back to the socket address when nothing was forwarded", () => {
    expect(clientIpOf(undefined, "127.0.0.1")).toBe("127.0.0.1");
  });

  it("falls back when the header is present but empty", () => {
    expect(clientIpOf("  ", "127.0.0.1")).toBe("127.0.0.1");
  });

  it("still returns a usable key when there is no address at all", () => {
    expect(clientIpOf(undefined, undefined)).toBe("unknown");
  });
});

describe("ConnectionLimiter", () => {
  it("admits up to the concurrent ceiling and refuses past it", () => {
    const limiter = new ConnectionLimiter({ maxPerIp: 2 });
    expect(limiter.admit("a").ok).toBe(true);
    expect(limiter.admit("a").ok).toBe(true);
    expect(limiter.admit("a")).toEqual({ ok: false, code: "too_many_connections" });
  });

  it("frees the slot when a socket closes", () => {
    const limiter = new ConnectionLimiter({ maxPerIp: 1 });
    const first = limiter.admit("a");
    expect(first.ok).toBe(true);
    expect(limiter.admit("a").ok).toBe(false);

    if (first.ok) first.release();
    expect(limiter.admit("a").ok).toBe(true);
  });

  it("ignores a repeated release, which a socket can produce", () => {
    const limiter = new ConnectionLimiter({ maxPerIp: 1 });
    const held = limiter.admit("a");
    const spare = limiter.admit("a");
    expect(spare.ok).toBe(false);

    if (held.ok) {
      held.release();
      held.release();
    }
    // One release freed one slot. A second must not conjure another.
    expect(limiter.admit("a").ok).toBe(true);
    expect(limiter.admit("a").ok).toBe(false);
  });

  it("keeps addresses apart", () => {
    const limiter = new ConnectionLimiter({ maxPerIp: 1 });
    expect(limiter.admit("a").ok).toBe(true);
    expect(limiter.admit("b").ok).toBe(true);
  });

  it("limits churn: connections that closed still count toward the window", () => {
    const limiter = new ConnectionLimiter({ maxAttemptsPerWindow: 2, windowMs: 1000 });
    for (let i = 0; i < 2; i += 1) {
      const admission = limiter.admit("a");
      expect(admission.ok).toBe(true);
      if (admission.ok) admission.release();
    }
    expect(limiter.admit("a")).toEqual({ ok: false, code: "too_many_attempts" });
  });

  it("lets the address back in once the window rolls over", () => {
    let clock = 0;
    const limiter = new ConnectionLimiter({
      maxAttemptsPerWindow: 1,
      windowMs: 1000,
      now: () => clock,
    });
    const first = limiter.admit("a");
    if (first.ok) first.release();
    expect(limiter.admit("a").ok).toBe(false);

    clock = 1000;
    expect(limiter.admit("a").ok).toBe(true);
  });

  it("refusal does not extend the penalty, so a shared address recovers", () => {
    let clock = 0;
    const limiter = new ConnectionLimiter({
      maxAttemptsPerWindow: 1,
      windowMs: 1000,
      now: () => clock,
    });
    const first = limiter.admit("a");
    if (first.ok) first.release();

    // Hammering throughout the window must not push the window forward.
    for (clock = 100; clock < 1000; clock += 100) {
      expect(limiter.admit("a").ok).toBe(false);
    }
    clock = 1000;
    expect(limiter.admit("a").ok).toBe(true);
  });

  it("stops allocating once the address table is full, and admits untracked", () => {
    const limiter = new ConnectionLimiter({ maxPerIp: 1, maxTrackedIps: 2 });
    expect(limiter.admit("a").ok).toBe(true);
    expect(limiter.admit("b").ok).toBe(true);
    expect(limiter.tracked).toBe(2);

    // The table is full, so a forged flood neither grows the heap nor gets
    // turned away — the per-address limit simply stops applying to it, which
    // is the deliberate trade. Cloud Run's concurrency ceiling is what holds.
    for (let i = 0; i < 1000; i += 1) {
      expect(limiter.admit(`spoofed-${i}`).ok).toBe(true);
    }
    expect(limiter.tracked).toBe(2);

    // The addresses that were already tracked keep their limits.
    expect(limiter.admit("a").ok).toBe(false);
  });

  it("prunes idle addresses but keeps ones holding a live socket", () => {
    let clock = 0;
    const limiter = new ConnectionLimiter({ windowMs: 1000, now: () => clock });
    const idle = limiter.admit("idle");
    limiter.admit("busy");
    if (idle.ok) idle.release();
    expect(limiter.tracked).toBe(2);

    clock = 999;
    limiter.prune();
    expect(limiter.tracked).toBe(2);

    clock = 1000;
    limiter.prune();
    expect(limiter.tracked).toBe(1);
  });

  it("releasing after a prune does not corrupt another address's count", () => {
    let clock = 0;
    const limiter = new ConnectionLimiter({ maxPerIp: 1, windowMs: 1000, now: () => clock });
    const held = limiter.admit("a");

    // `a` holds a live socket, so the sweep must leave it alone — the release
    // closure below still points at the entry the map holds.
    clock = 5000;
    limiter.prune();
    expect(limiter.tracked).toBe(1);

    if (held.ok) held.release();
    expect(limiter.admit("a").ok).toBe(true);
  });
});
