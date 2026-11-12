import { afterEach, describe, expect, it, vi } from "vitest";
import { FILM_HEAD_BYTES, createFilmHead, fetchFilmHead, filmHeadWanted, onCellular, warmWhenLoaded, type FilmHeadFetch } from "../../src/game/filmHead.js";
import { installStandInDom, type StandInVideo } from "./helpers/standInDom.js";

afterEach(() => vi.unstubAllGlobals());
function rig() {
  const doc = installStandInDom();
  const made: StandInVideo[] = [];
  const head = createFilmHead({
    video: () => {
      const v = doc.createElement("video") as StandInVideo;
      made.push(v);
      return v as unknown as HTMLVideoElement;
    },
  });
  return { head, made };
}

describe("the film's head start", () => {
  it("makes one inline element that preloads the film, its sound left on", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    head.warm("/intro.mp4");
    expect(made).toHaveLength(1);
    // Never muted: a film muted while it loaded and given its sound at Play starts its picture and then stands a quarter second for the sound.
    expect([made[0]!.getAttribute("src"), made[0]!.getAttribute("preload"), made[0]!.hasAttribute("playsinline"), made[0]!.muted]).toEqual(["/intro.mp4", "auto", true, false]);
  });
  it("hands the element over once, for the film it warmed", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    expect(head.take("/other.mp4")).toBeNull();
    expect(head.take("/intro.mp4")).toBe(made[0]);
    expect(head.take("/intro.mp4")).toBeNull();
  });
  it("makes no second element after the first was taken: a later hike makes its own", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    head.take("/intro.mp4");
    head.warm("/intro.mp4");
    expect(made).toHaveLength(1);
    expect(head.take("/intro.mp4")).toBeNull();
  });
  it("hands nothing over before it has warmed, or for an element that failed", () => {
    const { head, made } = rig();
    expect(head.take("/intro.mp4")).toBeNull();
    head.warm("/intro.mp4");
    (made[0] as unknown as { error: unknown }).error = { code: 4 };
    expect(head.take("/intro.mp4")).toBeNull();
    expect(made[0]!.getAttribute("src")).toBeNull();
    expect(made[0]!.loads).toBe(1);
  });
  it("ends the download when dropped", () => {
    const { head, made } = rig();
    head.warm("/intro.mp4");
    head.drop();
    expect(made[0]!.getAttribute("src")).toBeNull();
    expect(made[0]!.loads).toBe(1);
    expect(head.take("/intro.mp4")).toBeNull();
  });
  it("is wanted for a film on a connection the title loop would use", () => {
    expect(filmHeadWanted({ saveData: false, effectiveType: "4g" }, "/intro.mp4")).toBe(true);
    expect(filmHeadWanted({ saveData: false, effectiveType: null }, "/intro.mp4")).toBe(true);
    expect(filmHeadWanted({ saveData: true, effectiveType: "4g" }, "/intro.mp4")).toBe(false);
    expect(filmHeadWanted({ saveData: false, effectiveType: "3g" }, "/intro.mp4")).toBe(false);
    expect(filmHeadWanted({ saveData: false, effectiveType: "4g" }, null)).toBe(false);
  });
});

describe("the head start's moment", () => {
  it("warms at once on a page that has loaded", () => {
    let warmed = 0;
    warmWhenLoaded({ loaded: () => true, onLoad: () => { throw new Error("no listener is needed"); }, still: () => false }, () => { warmed++; });
    expect(warmed).toBe(1);
  });
  it("waits for the page's load, and warms then if the title page is still up", () => {
    let warmed = 0;
    let fire: () => void = () => undefined;
    warmWhenLoaded({ loaded: () => false, onLoad: (run) => { fire = run; }, still: () => true }, () => { warmed++; });
    expect(warmed).toBe(0);
    fire();
    expect(warmed).toBe(1);
  });
  it("does not warm at the page's load when Play was tapped first: the film is already playing from an element of its own", () => {
    let warmed = 0;
    let fire: () => void = () => undefined;
    warmWhenLoaded({ loaded: () => false, onLoad: (run) => { fire = run; }, still: () => false }, () => { warmed++; });
    fire();
    expect(warmed).toBe(0);
  });
});

describe("the film's first seconds, fetched", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** A stand-in fetch: what it was asked, and a reply the test settles. */
  function fakeFetch() {
    const asked: { url: string; range: string | null; signal: AbortSignal | undefined }[] = [];
    let reply!: (r: { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }) => void;
    let fail!: (e: unknown) => void;
    const fetch = ((url: string, init?: RequestInit) => {
      asked.push({ url, range: new Headers(init?.headers).get("Range"), signal: init?.signal ?? undefined });
      return new Promise((resolve, reject) => {
        reply = resolve;
        fail = reject;
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, asked, reply: (status: number) => reply({ ok: status < 400, status, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }), fail: (e: unknown) => fail(e) };
  }

  it("asks for the file's first four megabytes, as a range", async () => {
    const f = fakeFetch();
    const head = fetchFilmHead("/intro.mp4", { fetch: f.fetch });
    expect(FILM_HEAD_BYTES).toBe(4_000_000);
    expect(f.asked).toHaveLength(1);
    expect([f.asked[0]!.url, f.asked[0]!.range]).toEqual(["/intro.mp4", "bytes=0-3999999"]);
    f.reply(206);
    expect(await head.done).toBe(true);
  });
  it("takes a whole file as well as a part, and says no to an error, a failure or a stop, without throwing", async () => {
    const whole = fakeFetch();
    const a = fetchFilmHead("/intro.mp4", { fetch: whole.fetch });
    whole.reply(200);
    expect(await a.done).toBe(true);
    const missing = fakeFetch();
    const b = fetchFilmHead("/intro.mp4", { fetch: missing.fetch });
    missing.reply(404);
    expect(await b.done).toBe(false);
    const offline = fakeFetch();
    const c = fetchFilmHead("/intro.mp4", { fetch: offline.fetch });
    offline.fail(new TypeError("offline"));
    expect(await c.done).toBe(false);
    const stopped = fakeFetch();
    const d = fetchFilmHead("/intro.mp4", { fetch: stopped.fetch });
    d.stop();
    expect(stopped.asked[0]!.signal?.aborted).toBe(true);
    expect(await d.done).toBe(false);
  });

  /** A holder whose fetch the test settles. */
  function rigFetched() {
    const doc = installStandInDom();
    const made: StandInVideo[] = [];
    let settle!: (ok: boolean) => void;
    let stops = 0;
    const fetches: string[] = [];
    const head = createFilmHead({
      video: () => {
        const v = doc.createElement("video") as StandInVideo;
        made.push(v);
        return v as unknown as HTMLVideoElement;
      },
      fetchHead: (src): FilmHeadFetch => {
        fetches.push(src);
        return { done: new Promise<boolean>((resolve) => { settle = resolve; }), stop: () => { stops++; settle(false); } };
      },
    });
    return { head, made, fetches, settle: (ok: boolean) => settle(ok), stops: () => stops };
  }

  it("fetches the head first and makes the film's element when it is in, so the element reads what was fetched", async () => {
    const r = rigFetched();
    r.head.warm("/intro.mp4");
    expect(r.fetches).toEqual(["/intro.mp4"]);
    expect(r.made).toHaveLength(0);
    r.settle(true);
    await tick();
    expect(r.made).toHaveLength(1);
    expect(r.head.take("/intro.mp4")).toBe(r.made[0]);
  });
  it("makes the element all the same when the fetch fails: it preloads for itself where the browser lets it", async () => {
    const r = rigFetched();
    r.head.warm("/intro.mp4");
    r.settle(false);
    await tick();
    expect(r.made).toHaveLength(1);
  });
  it("stops the fetch when the film is taken before it is in, hands nothing over, and makes no element after", async () => {
    const r = rigFetched();
    r.head.warm("/intro.mp4");
    expect(r.head.take("/intro.mp4")).toBeNull();
    expect(r.stops()).toBe(1);
    await tick();
    expect(r.made).toHaveLength(0);
  });
  it("makes the element at once where no fetch is wanted: the browser's own preload is the head start there", () => {
    const doc = installStandInDom();
    const made: StandInVideo[] = [];
    const head = createFilmHead({
      video: () => {
        const v = doc.createElement("video") as StandInVideo;
        made.push(v);
        return v as unknown as HTMLVideoElement;
      },
      fetchHead: () => null,
    });
    head.warm("/intro.mp4");
    expect(made).toHaveLength(1);
    expect(head.take("/intro.mp4")).toBe(made[0]);
  });
  it("tells a cellular connection from the rest, and a browser that does not say from one", () => {
    expect(onCellular({ connection: { type: "cellular" } })).toBe(true);
    expect(onCellular({ connection: { type: "wifi" } })).toBe(false);
    expect(onCellular({ connection: {} })).toBe(false);
    expect(onCellular({})).toBe(false);
  });
  it("stops the fetch on a drop", async () => {
    const r = rigFetched();
    r.head.warm("/intro.mp4");
    r.head.drop();
    expect(r.stops()).toBe(1);
    await tick();
    expect(r.made).toHaveLength(0);
  });
});
