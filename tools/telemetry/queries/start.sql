-- How long a hike takes to be ready for those who press Play: one line a
-- build, newest first, and one line `all`, over the sessions that pressed
-- Play in the range.
-- A hike is ready (`ready`) when its world can be looked at, which is when
-- the intro shows `hold to skip`. `ready_s` is the wait from the first Play
-- of a session (`play`) to the first `ready` after it, by the rows' `t`
-- (milliseconds since the page loaded, set as each row is made: a row's
-- `timestamp` is its batch's and cannot time a start), so a build from
-- before the fields below is timed too: its median, 75th and 90th
-- percentile. `played` pressed Play; `ready` reached it;
-- `failed` had a start that failed (`start_fail`); `left` did neither, and
-- `left_s` is the median time from their Play to the last row they sent,
-- which is how long those who gave up waited.
-- Before the hike is launched, from the `load` row of that start, medians
-- in seconds: `decide_s`, the tier decided (with its probe, where one ran);
-- `intro_s`, the wait for the intro's film to buffer before the engine is
-- made; `film_s`, the film's top-up before the build; `world_s`, what the
-- start then still waited for the world's worker.
-- From engine v0.2.15 the `ready` row says where the wait was, each a median
-- in seconds from the hike's launch: `ground_s`, the ground's images and the
-- sounds in; `terrain_s`, the terrain's first ring standing, which is the
-- renderer made; `models_asked_s`, the first model asked for; `models_s`,
-- the last model in and parsed. `net_mb` is the median megabytes that came
-- over the network from Play on. A session is `cold` where the browser's
-- cache answered under half the files it asked for and `warm` otherwise (a
-- returning player's), and `cold_s` and `warm_s` are the median wait of
-- each. `ahead` counts the sessions whose world was made before Play, on
-- the landing page (`load`, from v0.2.14).
-- The film: `paced` sessions sent a `pace` row (the load under the intro
-- was paced by the film's frames), `cut` of them had the pace cut for the
-- film's sake at least once, and `film_missed_p90` is the 90th percentile
-- of the film's frames missed while it was paced.
-- A figure no session of a line sent reads null, never zero.
-- The rows that are real play, the same text in every query (`README.md`):
-- not the deploy's verification (`build = 'verify'` on a page's rows,
-- `verify` on signaling's), not the owner's test browsers (`tester`), not a
-- session of the README's stills shoot (one with a `cmd` row, looked for over
-- the last ninety days), not a headless or automated browser (a `SwiftShader`
-- GPU, a `HeadlessChrome` user agent, or `wd`, the page's navigator.webdriver:
-- headless Chrome on a real GPU names NVIDIA or Apple, not SwiftShader).
WITH real AS (
  SELECT timestamp, json_payload
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE IFNULL(JSON_VALUE(json_payload.build), '') != 'verify'
    AND IFNULL(JSON_VALUE(json_payload.tester), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.verify), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.gpu), '') NOT LIKE '%SwiftShader%'
    AND IFNULL(JSON_VALUE(json_payload.ua), '') NOT LIKE '%HeadlessChrome%'
    AND IFNULL(JSON_VALUE(json_payload.wd), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.sid), '') NOT IN (
      SELECT DISTINCT JSON_VALUE(json_payload.sid)
      FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
      WHERE JSON_VALUE(json_payload.n) = 'cmd'
        AND JSON_VALUE(json_payload.sid) IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    )
),
events AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.n) AS n,
    CAST(JSON_VALUE(json_payload.t) AS INT64) AS t,
    JSON_VALUE(json_payload.ahead) AS ahead,
    CAST(JSON_VALUE(json_payload.decideMs) AS INT64) AS decide_ms,
    CAST(JSON_VALUE(json_payload.introMs) AS INT64) AS intro_ms,
    CAST(JSON_VALUE(json_payload.filmMs) AS INT64) AS film_ms,
    CAST(JSON_VALUE(json_payload.worldMs) AS INT64) AS world_ms,
    CAST(JSON_VALUE(json_payload.groundMs) AS INT64) AS ground_ms,
    CAST(JSON_VALUE(json_payload.terrainMs) AS INT64) AS terrain_ms,
    CAST(JSON_VALUE(json_payload.modelsAskedMs) AS INT64) AS models_asked_ms,
    CAST(JSON_VALUE(json_payload.modelsMs) AS INT64) AS models_ms,
    CAST(JSON_VALUE(json_payload.netMB) AS FLOAT64) AS net_mb,
    CAST(JSON_VALUE(json_payload.files) AS INT64) AS files,
    CAST(JSON_VALUE(json_payload.cached) AS INT64) AS cached,
    CAST(JSON_VALUE(json_payload.cuts) AS INT64) AS cuts,
    CAST(JSON_VALUE(json_payload.slips) AS INT64) AS slips,
    CAST(JSON_VALUE(json_payload.frames) AS INT64) AS film_missed,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
),
played AS (
  SELECT sid, MIN(t) AS played_t
  FROM events
  WHERE n = 'play'
  GROUP BY sid
),
after_play AS (
  SELECT e.*, p.played_t
  FROM events AS e
  JOIN played AS p USING (sid)
),
per_session AS (
  SELECT
    sid,
    ANY_VALUE(build HAVING MAX timestamp) AS build,
    ANY_VALUE(played_t) AS played_t,
    MIN(IF(n = 'ready' AND t >= played_t, t, NULL)) AS ready_t,
    MIN(IF(n = 'load' AND t >= played_t, t, NULL)) AS load_t,
    LOGICAL_OR(n = 'start_fail' AND t >= played_t) AS failed,
    MAX(t) AS last_t,
    LOGICAL_OR(n = 'pace') AS paced,
    MAX(IF(n = 'pace', cuts + slips, NULL)) AS pace_cuts,
    MAX(IF(n = 'pace', film_missed, NULL)) AS film_missed,
    MAX(timestamp) AS last_at
  FROM after_play
  GROUP BY sid
),
timed AS (
  SELECT
    s.sid,
    s.build,
    s.ready_t IS NOT NULL AS got_ready,
    s.failed,
    (s.ready_t - s.played_t) / 1000 AS ready_s,
    IF(s.ready_t IS NULL AND NOT s.failed, (s.last_t - s.played_t) / 1000, NULL) AS left_s,
    l.ahead = 'true' AS ahead,
    l.decide_ms,
    l.intro_ms,
    l.film_ms,
    l.world_ms,
    r.ground_ms,
    r.terrain_ms,
    r.models_asked_ms,
    r.models_ms,
    r.net_mb,
    IF(r.files IS NULL OR r.files = 0, NULL, r.cached * 2 < r.files) AS cold,
    s.paced,
    s.pace_cuts,
    s.film_missed,
    s.last_at
  FROM per_session AS s
  LEFT JOIN events AS l ON l.sid = s.sid AND l.n = 'load' AND l.t = s.load_t
  LEFT JOIN events AS r ON r.sid = s.sid AND r.n = 'ready' AND r.t = s.ready_t
)
SELECT
  grp AS build,
  COUNT(*) AS played,
  COUNTIF(got_ready) AS ready,
  COUNTIF(NOT got_ready AND failed) AS failed,
  COUNTIF(NOT got_ready AND NOT failed) AS `left`,
  ROUND(APPROX_QUANTILES(ready_s, 100 IGNORE NULLS)[OFFSET(50)], 1) AS ready_s_median,
  ROUND(APPROX_QUANTILES(ready_s, 100 IGNORE NULLS)[OFFSET(75)], 1) AS ready_s_p75,
  ROUND(APPROX_QUANTILES(ready_s, 100 IGNORE NULLS)[OFFSET(90)], 1) AS ready_s_p90,
  ROUND(APPROX_QUANTILES(left_s, 100 IGNORE NULLS)[OFFSET(50)], 1) AS left_s,
  ROUND(APPROX_QUANTILES(decide_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS decide_s,
  ROUND(APPROX_QUANTILES(intro_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS intro_s,
  ROUND(APPROX_QUANTILES(film_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS film_s,
  ROUND(APPROX_QUANTILES(world_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS world_s,
  COUNTIF(ahead) AS ahead,
  COUNTIF(cold) AS cold,
  COUNTIF(NOT cold) AS warm,
  ROUND(APPROX_QUANTILES(IF(cold, ready_s, NULL), 100 IGNORE NULLS)[OFFSET(50)], 1) AS cold_s,
  ROUND(APPROX_QUANTILES(IF(NOT cold, ready_s, NULL), 100 IGNORE NULLS)[OFFSET(50)], 1) AS warm_s,
  ROUND(APPROX_QUANTILES(ground_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS ground_s,
  ROUND(APPROX_QUANTILES(terrain_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS terrain_s,
  ROUND(APPROX_QUANTILES(models_asked_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS models_asked_s,
  ROUND(APPROX_QUANTILES(models_ms, 100 IGNORE NULLS)[OFFSET(50)] / 1000, 1) AS models_s,
  ROUND(APPROX_QUANTILES(net_mb, 100 IGNORE NULLS)[OFFSET(50)], 1) AS net_mb,
  COUNTIF(paced) AS paced,
  COUNTIF(pace_cuts > 0) AS cut,
  APPROX_QUANTILES(film_missed, 100 IGNORE NULLS)[OFFSET(90)] AS film_missed_p90,
  MAX(last_at) AS last_seen
FROM timed, UNNEST([timed.build, 'all']) AS grp
GROUP BY grp
ORDER BY IF(grp = 'all', 0, 1), last_seen DESC;
