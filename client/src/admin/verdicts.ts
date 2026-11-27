/**
 * How a player's machine and game are put in words, and the marks a load
 * time or a frame rate is judged against. Split from `views.ts` so `profile.ts`
 * can use them without a cycle; `views.ts` re-exports them.
 */

/** An operating system as people say it, from the page's `os` (`darwin-arm64`, `win32-x64`, `android-arm64`). */
export function osName(raw: string): string {
  const os = raw.split(/[-\s]/)[0]?.toLowerCase() ?? "";
  return ({ darwin: "macOS", win32: "Windows", linux: "Linux", android: "Android", ios: "iOS", cros: "ChromeOS" } as Record<string, string>)[os] ?? (raw === "" ? "" : "Other");
}

/**
 * How a player's game went, by the two things a player feels: how long it took
 * to load (from Play to the world's first whole frame, `health.sql`) and how
 * smoothly it ran (the median frame rate in a match). Each is good, slow or bad against the marks below;
 * a player's verdict is the worse of the two, and a player with neither (gone
 * before the world was in) has none.
 */
export const LOAD_MS = { good: 15_000, slow: 30_000 } as const;
export const FPS = { good: 50, slow: 30 } as const;
export type Verdict = "good" | "slow" | "bad";
export const RANK: Record<Verdict, number> = { good: 0, slow: 1, bad: 2 };
export const WORDS: Record<Verdict, string> = { good: "Good", slow: "Slow", bad: "Bad" };

export function loadVerdict(ms: number | null): Verdict | null {
  if (ms === null) return null;
  return ms <= LOAD_MS.good ? "good" : ms <= LOAD_MS.slow ? "slow" : "bad";
}
export function fpsVerdict(fps: number | null): Verdict | null {
  if (fps === null) return null;
  return fps >= FPS.good ? "good" : fps >= FPS.slow ? "slow" : "bad";
}
export function playerVerdict(row: Record<string, unknown>): Verdict | null {
  const marks = [loadVerdict(present(row.load_ms)), fpsVerdict(present(row.fps))].filter((v): v is Verdict => v !== null);
  return marks.length === 0 ? null : marks.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}
/** A number from a row, or null where the row has none (a session that never reached that point). */
export function present(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** A GPU's name as people say it: the renderer string's ANGLE wrapping and driver text dropped. */
export function gpuName(raw: string): string {
  const angle = /^ANGLE \([^,]*,\s*([^,]+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|,|\)$|$)/i.exec(raw);
  // A driver's own words in brackets at the end (`(radeonsi navi22 LLVM 17.0.6)`) go too.
  // and so do ANGLE's renderer label (`ANGLE Metal Renderer: Apple M3 Max`) and a GL bus suffix (`/PCIe/SSE2`).
  return (angle?.[1] ?? raw)
    .replace(/\s*\([^)]*\)$/, "")
    .replace(/^ANGLE [A-Za-z0-9]+ Renderer:\s*/, "")
    .replace(/\/PCIe\/SSE2$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
