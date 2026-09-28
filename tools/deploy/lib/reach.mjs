// A fetch for the deploy check that never throws: a request that gets no
// answer (DNS, a reset connection, a timeout) is a response that failed, its
// status naming the error, so that the check reports it as it reports any
// other failed response and the checks after it still run.

/** `fetchImpl(url, init)`, or, where it throws, a failed response whose
 * `status` is `no answer (<the error>)` and whose body is empty. */
export async function reach(url, init, fetchImpl = fetch) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    return {
      status: `no answer (${error?.message ?? String(error)})`,
      ok: false,
      headers: new Headers(),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => null,
    };
  }
}
