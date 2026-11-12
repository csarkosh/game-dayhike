// A film over the page (the intro): whether it paused, by two measures a page stop cannot fake.
//
// The clock: the film's `currentTime` beside the page's clock, both read in one go (a run's
// `video` rows, four a second). A step is a pair of rows between which more wall time passed
// than film time: the film waited.
//
// The picture: a frame callback's own numbers, the film time of the frame presented and the
// count of frames presented so far (a run's `shown` rows). A skip is film time that passed with
// no frame presented for it: the picture stood, then jumped.
//
// Neither uses the wall time between two frame callbacks. A callback that arrives after a page
// stop can carry a timestamp from before the stop, so the pair after it reads as a pause as long
// as the stop while the film played through it.

/** The film's end as the run saw it: the largest `currentTime` sampled; null with fewer than two rows. */
export function filmEnd(video) {
  return video.length < 2 ? null : Math.max(...video.map((v) => v.at));
}

/** The film's length where the run's rows carry it (`dur`), else null: an older run's do not. */
export function filmLength(video) {
  for (let i = video.length - 1; i >= 0; i--) if (Number.isFinite(video[i].dur) && video[i].dur > 0) return video[i].dur;
  return null;
}

/**
 * The rows from while the film played. With the film's end known (`endT`, page ms: the run's
 * `film-end` mark), every row up to it. Without, the rows before the largest `currentTime`
 * sampled: a film that has ended stands, which is not a pause, and so does one that stalled for
 * good, which `verdict.mjs` tells apart by the film's length.
 */
export function playing(video, endT = null) {
  if (endT !== null) return video.filter((v) => v.t <= endT);
  const end = filmEnd(video);
  return end === null ? [] : video.filter((v) => v.at < end - 0.1);
}

/**
 * The steps the film's clock fell behind the page's, each `{ t, behind }`: page ms of the step's
 * start, seconds. A pause that spans several rows is one step, its size their sum: read a row at a
 * time, a pause of any length would be slices of a quarter of a second.
 */
export function clockSteps(video, { min = 0.03, endT = null } = {}) {
  const rows = playing(video, endT);
  const steps = [];
  let open = null;
  for (let i = 1; i < rows.length; i++) {
    const behind = (rows[i].t - rows[i - 1].t) / 1000 - (rows[i].at - rows[i - 1].at);
    if (behind > min) {
      if (open === null) steps.push((open = { t: rows[i - 1].t, behind: 0 }));
      open.behind += behind;
    } else open = null;
  }
  return steps;
}

/** The film's frames a second: from callbacks one frame apart, 24 where there are none. */
export function filmRate(shown) {
  const d = [];
  for (let i = 1; i < shown.length; i++) {
    const frames = shown[i][2] - shown[i - 1][2], film = shown[i][1] - shown[i - 1][1];
    if (frames === 1 && film > 0) d.push(film);
  }
  d.sort((a, b) => a - b);
  return d.length > 0 ? 1 / d[d.length >> 1] : 24;
}

/**
 * The film time that passed with no frame presented for it, each `{ t, skipped }`: page ms (the
 * frame's presentation time where the run has it, the callback's otherwise), seconds.
 */
export function pictureSkips(shown, { min = 0.06, rate = 24 } = {}) {
  const skips = [];
  for (let i = 1; i < shown.length; i++) {
    const a = shown[i - 1], b = shown[i];
    const skipped = b[1] - a[1] - (b[2] - a[2]) / rate;
    if (skipped > min) skips.push({ t: b[3] ?? b[0], skipped });
  }
  return skips;
}
