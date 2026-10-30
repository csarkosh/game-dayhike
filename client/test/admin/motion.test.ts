import { afterEach, describe, it, expect } from "vitest";
import { parseDuration, tokens } from "../../src/admin/motion.js";
import { drawerExitMs } from "../../src/admin/views.js";

// The motion tokens as the host's `/theme.css` sets them on :root (csarko.sh `admin/public/theme.css`),
// with the leading space a computed custom property keeps.
const TOKENS: Record<string, string> = {
  "--md-easing-standard": " cubic-bezier(0.2, 0, 0, 1)",
  "--md-easing-emphasized-decelerate": " cubic-bezier(0.05, 0.7, 0.1, 1)",
  "--md-easing-emphasized-accelerate": " cubic-bezier(0.3, 0, 0.8, 0.15)",
  "--md-duration-short2": " 100ms",
  "--md-duration-short3": " 150ms",
  "--md-duration-short4": " 200ms",
  "--md-duration-medium2": " 300ms",
  "--md-duration-medium4": " 400ms",
};
// What the host's prefers-reduced-motion block leaves on :root.
const REDUCED = Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, k.includes("duration") ? " 0ms" : v]));
const reader = (values: Record<string, string>) => (name: string): string => values[name] ?? "";

// vitest runs the admin tests under plain Node: a page whose :root carries `values`, for the
// functions that read the tokens off it.
const g = globalThis as unknown as Record<string, unknown>;
function withPage<T>(values: Record<string, string>, fn: () => T): T {
  const root = {};
  g.document = { documentElement: root };
  g.getComputedStyle = (node: unknown) => (node === root ? { getPropertyValue: reader(values) } : { opacity: "1", transform: "none", getPropertyValue: () => "" });
  return fn();
}
afterEach(() => {
  delete g.document;
  delete g.getComputedStyle;
});

describe("parseDuration reads a CSS time in milliseconds", () => {
  it("reads milliseconds and seconds", () => {
    expect(parseDuration("150ms")).toBe(150);
    expect(parseDuration("0.3s")).toBe(300);
    expect(parseDuration("0ms")).toBe(0);
    expect(parseDuration(" 200ms ")).toBe(200);
  });

  it("falls back on an empty or unreadable value", () => {
    expect(parseDuration("")).toBe(0);
    expect(parseDuration("", 42)).toBe(42);
    expect(parseDuration("abc", 42)).toBe(42);
    expect(parseDuration("150", 42)).toBe(42);
    expect(parseDuration(undefined, 7)).toBe(7);
  });
});

describe("tokens() reads the motion tokens off :root", () => {
  it("reads the three easings and five durations", () => {
    expect(withPage(TOKENS, () => tokens())).toEqual({
      standard: "cubic-bezier(0.2, 0, 0, 1)",
      decelerate: "cubic-bezier(0.05, 0.7, 0.1, 1)",
      accelerate: "cubic-bezier(0.3, 0, 0.8, 0.15)",
      short2: 100, short3: 150, short4: 200, medium2: 300, medium4: 400,
    });
  });

  it("reads every duration as 0 under reduced motion, and without the tokens", () => {
    for (const values of [REDUCED, {}]) {
      const t = withPage(values, () => tokens());
      for (const key of ["short2", "short3", "short4", "medium2", "medium4"] as const) expect(t[key]).toBe(0);
    }
  });
});

describe("a drawer leaves over the short4 token", () => {
  it("takes the token's value, read through parseDuration", () => {
    const asked: string[] = [];
    expect(drawerExitMs((name) => (asked.push(name), TOKENS[name] ?? ""))).toBe(200);
    expect(asked).toEqual(["--md-duration-short4"]);
  });

  it("is 0 under reduced motion, and without the token, so nothing waits to remove it", () => {
    expect(drawerExitMs(reader(REDUCED))).toBe(0);
    expect(drawerExitMs(reader({}))).toBe(0);
  });

  it("reads :root by default", () => {
    expect(withPage(TOKENS, () => drawerExitMs())).toBe(200);
  });
});
