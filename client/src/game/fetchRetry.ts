/**
 * A download asked for again when the network drops it.
 *
 * A hike's models and ground maps are each fetched once, and whoever asks
 * draws nothing of that kind if the fetch throws: a forest with no trees for
 * the whole hike, for one dropped connection. So a fetch that fails the way a
 * network fails (it throws, or the body stops arriving, or the server answers
 * 408, 429 or a 5xx) is tried again, `FETCH_TRIES` times in all, with a short
 * pause between tries. An answer that will not change (any other status) is
 * thrown at once, and so is everything once the caller's signal has aborted.
 */

/** How many times a download is asked for before its failure is thrown. */
export const FETCH_TRIES = 3;

/** The pause before the second try and before the third (ms). */
export const FETCH_PAUSES_MS: readonly number[] = [400, 1200];

export interface FetchRetryDeps {
  fetch: (url: string, init: { signal?: AbortSignal }) => Promise<Response>;
  /** Resolves after `ms`; rejects with the signal's reason if it aborts first. */
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const browserDeps: FetchRetryDeps = {
  fetch: (url, init) => globalThis.fetch(url, init),
  wait: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason);
        return;
      }
      const stop = (): void => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", stop);
        resolve();
      }, ms);
      signal?.addEventListener("abort", stop, { once: true });
    }),
};

/** Whether a server's answer may be another one when asked again. */
export function statusMayPass(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * What `read` makes of the answer at `url`. `read` takes the body (its
 * `arrayBuffer`, its `blob`): a body that stops arriving is a failed try like
 * a fetch that throws. It throws `<url>: HTTP <status>` for an answer that is
 * not ok, the last failure when every try has failed, and the signal's reason
 * as soon as the signal aborts.
 */
export async function fetchRetried<T>(
  url: string,
  signal: AbortSignal | undefined,
  read: (response: Response) => Promise<T>,
  deps: FetchRetryDeps = browserDeps,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= FETCH_TRIES - 1;
    let status: number | null = null;
    try {
      const response = await deps.fetch(url, { signal });
      if (response.ok) return await read(response);
      status = response.status;
    } catch (error) {
      if (last || signal?.aborted === true) throw error;
    }
    if (status !== null && (last || !statusMayPass(status))) throw new Error(`${url}: HTTP ${status}`);
    await deps.wait(FETCH_PAUSES_MS[Math.min(attempt, FETCH_PAUSES_MS.length - 1)] as number, signal);
  }
}
