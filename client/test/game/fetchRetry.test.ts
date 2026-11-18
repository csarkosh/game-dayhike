import { describe, expect, it } from "vitest";
import { FETCH_PAUSES_MS, FETCH_TRIES, fetchRetried, statusMayPass, type FetchRetryDeps } from "../../src/game/fetchRetry.js";

type Answer = { ok: boolean; status: number; body?: string; bodyFails?: boolean } | Error;

/** A network that gives `answers` in order, and the pauses it was asked to wait. */
function network(answers: Answer[], signal?: AbortController): { deps: FetchRetryDeps; asked: string[]; waited: number[] } {
  const asked: string[] = [];
  const waited: number[] = [];
  const deps: FetchRetryDeps = {
    fetch: async (url) => {
      asked.push(url);
      const answer = answers[asked.length - 1];
      if (answer === undefined) throw new Error("asked more often than the test answers");
      if (answer instanceof Error) throw answer;
      return {
        ok: answer.ok,
        status: answer.status,
        text: async () => {
          if (answer.bodyFails === true) throw new TypeError("network error");
          return answer.body ?? "";
        },
      } as unknown as Response;
    },
    wait: async (ms, s) => {
      waited.push(ms);
      if (s?.aborted === true) throw s.reason;
      void signal;
    },
  };
  return { deps, asked, waited };
}

const text = (response: Response): Promise<string> => response.text();

describe("a download asked for again when the network drops it", () => {
  it("asks three times in all, with a pause before the second and the third", () => {
    expect(FETCH_TRIES).toBe(3);
    expect(FETCH_PAUSES_MS).toEqual([400, 1200]);
    expect(FETCH_PAUSES_MS.length).toBe(FETCH_TRIES - 1);
  });

  it("gives the first good answer and asks no more", async () => {
    const { deps, asked, waited } = network([{ ok: true, status: 200, body: "trees" }]);
    await expect(fetchRetried("pine.glb", undefined, text, deps)).resolves.toBe("trees");
    expect(asked).toEqual(["pine.glb"]);
    expect(waited).toEqual([]);
  });

  it("asks again after a fetch that throws, and after a body that stops arriving", async () => {
    const { deps, asked, waited } = network([new TypeError("Failed to fetch"), { ok: true, status: 200, bodyFails: true }, { ok: true, status: 200, body: "trees" }]);
    await expect(fetchRetried("pine.glb", undefined, text, deps)).resolves.toBe("trees");
    expect(asked.length).toBe(3);
    expect(waited).toEqual([400, 1200]);
  });

  it("throws the last failure when every try has failed", async () => {
    const lastFailure = new TypeError("Failed to fetch (third)");
    const { deps, asked, waited } = network([new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), lastFailure]);
    await expect(fetchRetried("pine.glb", undefined, text, deps)).rejects.toBe(lastFailure);
    expect(asked.length).toBe(FETCH_TRIES);
    expect(waited).toEqual([400, 1200]);
  });

  it("asks again for an answer that may pass, and names the status when it does not", async () => {
    expect([408, 429, 500, 502, 503, 504].every(statusMayPass)).toBe(true);
    expect([301, 400, 401, 403, 404, 410].some(statusMayPass)).toBe(false);
    const passing = network([{ ok: false, status: 503 }, { ok: true, status: 200, body: "ground" }]);
    await expect(fetchRetried("ground.webp", undefined, text, passing.deps)).resolves.toBe("ground");
    expect(passing.waited).toEqual([400]);
    const failing = network([{ ok: false, status: 503 }, { ok: false, status: 503 }, { ok: false, status: 503 }]);
    await expect(fetchRetried("ground.webp", undefined, text, failing.deps)).rejects.toThrow("ground.webp: HTTP 503");
    expect(failing.asked.length).toBe(FETCH_TRIES);
  });

  it("throws an answer that will not change at once", async () => {
    const { deps, asked, waited } = network([{ ok: false, status: 404 }]);
    await expect(fetchRetried("ground.webp", undefined, text, deps)).rejects.toThrow("ground.webp: HTTP 404");
    expect(asked.length).toBe(1);
    expect(waited).toEqual([]);
  });

  it("asks no more once the caller's signal has aborted", async () => {
    const abort = new AbortController();
    const aborted = new DOMException("left the hike", "AbortError");
    const { deps, asked } = network([aborted, { ok: true, status: 200, body: "never read" }]);
    abort.abort(aborted);
    await expect(fetchRetried("pine.glb", abort.signal, text, deps)).rejects.toBe(aborted);
    expect(asked.length).toBe(1);
  });

  it("stops in the pause when the signal aborts there", async () => {
    const abort = new AbortController();
    const reason = new DOMException("left the hike", "AbortError");
    const { deps, asked } = network([new TypeError("Failed to fetch"), { ok: true, status: 200, body: "never read" }]);
    const waitThenAbort: FetchRetryDeps = {
      fetch: deps.fetch,
      wait: async () => {
        abort.abort(reason);
        throw abort.signal.reason;
      },
    };
    await expect(fetchRetried("pine.glb", abort.signal, text, waitThenAbort)).rejects.toBe(reason);
    expect(asked.length).toBe(1);
  });
});
