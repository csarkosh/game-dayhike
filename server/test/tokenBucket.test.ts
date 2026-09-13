import { describe, it, expect } from "vitest";
import { TokenBucket } from "../src/tokenBucket.js";

/** A bucket on a clock the test drives, so refill is exact rather than raced. */
function bucketAt(capacity: number, refillPerSecond: number) {
  const clock = { ms: 0 };
  const bucket = new TokenBucket(capacity, refillPerSecond, () => clock.ms);
  return { bucket, clock };
}

describe("TokenBucket", () => {
  it("starts full, so the capacity is a burst allowance", () => {
    const { bucket } = bucketAt(3, 1);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("refills at the stated rate", () => {
    const { bucket, clock } = bucketAt(2, 10);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    clock.ms = 100; // 10/s for 100ms = exactly one token
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("refills proportionally, not in whole tokens", () => {
    const { bucket, clock } = bucketAt(1, 10);
    expect(bucket.tryConsume()).toBe(true);

    clock.ms = 50; // half a token
    expect(bucket.tryConsume()).toBe(false);
    expect(bucket.available).toBeCloseTo(0.5);

    clock.ms = 100; // the other half
    expect(bucket.tryConsume()).toBe(true);
  });

  it("never accrues past capacity, however long it idles", () => {
    const { bucket, clock } = bucketAt(2, 100);
    expect(bucket.tryConsume()).toBe(true);

    clock.ms = 60_000;
    expect(bucket.available).toBeLessThanOrEqual(2);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("does not mint tokens when the clock goes backwards", () => {
    const { bucket, clock } = bucketAt(1, 1000);
    expect(bucket.tryConsume()).toBe(true);

    clock.ms = -5_000;
    expect(bucket.tryConsume()).toBe(false);

    // And the backwards jump must not have poisoned the refill baseline:
    // one second's worth from where it actually was still works.
    clock.ms = 1_000;
    expect(bucket.tryConsume()).toBe(true);
  });

  it("sustains exactly the refill rate indefinitely", () => {
    const { bucket, clock } = bucketAt(5, 10);
    for (let i = 0; i < 5; i += 1) expect(bucket.tryConsume()).toBe(true);

    // One message every 100ms is precisely 10/s, and must never be refused.
    for (let tick = 1; tick <= 50; tick += 1) {
      clock.ms = tick * 100;
      expect(bucket.tryConsume()).toBe(true);
    }
  });

  it("refuses a sender running just above the refill rate", () => {
    const { bucket, clock } = bucketAt(5, 10);
    let refusals = 0;
    // 20/s against a 10/s refill: the burst absorbs the early excess, then it
    // has to start failing.
    for (let tick = 1; tick <= 40; tick += 1) {
      clock.ms = tick * 50;
      if (!bucket.tryConsume()) refusals += 1;
    }
    expect(refusals).toBeGreaterThan(0);
  });
});
