-- Players: one line a player (a browser, `vid`; a session whose storage
-- refused the id stands alone under its `sid`) over the range, the most
-- recently seen first: everything the admin page says of one person, once.
-- Engagement: their sessions, on how many calendar days of the range (New
-- York's when pasted, the viewer's on the page), whether they are returning
-- (seen on more than one day in the last ninety, as `kpis.sql` counts them), how many played a match and how many
-- reached an outcome, the farthest they climbed (`p`, 0 at the trailhead and 1
-- at the crest) and the best way a match of theirs ended (won before lost),
-- whether they died, and the largest party they played in. Performance: the
-- load, the whole wait after Play (the `load` row's start chain, the tier's
-- decision, the engine and the build, then the `ready` row's `ms` to the
-- world's first whole frame), the median over their sessions that got that
-- far; the frame rate, the median of each session's heartbeat median (`hb`,
-- every 30 s of a match); and the worst frame any heartbeat reported. And who
-- they are: the machine they were last seen on (the `gpu`, the `os`, the
-- `load` row's tier and engine) and where they were last placed (`geo`
-- rows, from csarko.sh's analytics collector's city database; never an
-- address). Replaces `health.sql` and `visitors.sql` (2026-11-21).
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
-- Each session's place: the `geo` row the server writes after a session's
-- first batch, from csarko.sh's analytics collector's city database (the
-- country, region and city; never the address).
places AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    ANY_VALUE(JSON_VALUE(json_payload.ct)) AS city,
    ANY_VALUE(JSON_VALUE(json_payload.rg)) AS region,
    ANY_VALUE(JSON_VALUE(json_payload.cc)) AS country
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND JSON_VALUE(json_payload.n) = 'geo'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
  GROUP BY sid
),
-- Each browser's days in the last ninety, whatever the range: returning is
-- more than one, the same test as `kpis.sql`'s returning visitors.
visitor_days AS (
  SELECT
    JSON_VALUE(json_payload.vid) AS vid,
    COUNT(DISTINCT DATE(timestamp, 'America/New_York')) AS days
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND IFNULL(JSON_VALUE(json_payload.vid), '') != ''
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
  GROUP BY vid
),
events AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.vid) AS vid,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.tier) AS tier,
    JSON_VALUE(json_payload.engine) AS engine,
    JSON_VALUE(json_payload.os) AS os,
    JSON_VALUE(json_payload.gpu) AS gpu,
    JSON_VALUE(json_payload.result) AS result,
    CAST(JSON_VALUE(json_payload.party) AS INT64) AS party,
    CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
    CAST(JSON_VALUE(json_payload.decideMs) AS INT64) AS decide_ms,
    CAST(JSON_VALUE(json_payload.engineMs) AS INT64) AS engine_ms,
    CAST(JSON_VALUE(json_payload.buildMs) AS INT64) AS build_ms,
    CAST(JSON_VALUE(json_payload.ms) AS INT64) AS ready_ms,
    CAST(JSON_VALUE(json_payload.fps) AS FLOAT64) AS fps,
    CAST(JSON_VALUE(json_payload.worst) AS INT64) AS worst_ms,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
),
per_session AS (
  SELECT
    sid,
    IFNULL(NULLIF(ANY_VALUE(vid), ''), sid) AS player,
    ANY_VALUE(build HAVING MAX timestamp) AS build,
    ANY_VALUE(os) AS os,
    MAX(gpu) AS gpu,
    MAX(IF(n = 'load', tier, NULL)) AS tier,
    MAX(IF(n = 'load', engine, NULL)) AS engine,
    IFNULL(MAX(IF(n = 'load', decide_ms, NULL)), 0) + IFNULL(MAX(IF(n = 'load', engine_ms, NULL)), 0) + IFNULL(MAX(IF(n = 'load', build_ms, NULL)), 0) + MAX(IF(n = 'ready', ready_ms, NULL)) AS load_ms,
    APPROX_QUANTILES(IF(n = 'hb', fps, NULL), 2)[OFFSET(1)] AS median_fps,
    MAX(IF(n = 'hb', worst_ms, NULL)) AS worst_ms,
    LOGICAL_OR(n = 'match_start') AS played,
    LOGICAL_OR(n = 'outcome') AS finished,
    MAX(IF(n IN ('hb', 'outcome'), p, NULL)) AS farthest,
    LOGICAL_OR(n = 'outcome' AND result = 'won') AS won,
    LOGICAL_OR(n = 'outcome' AND result = 'lost') AS lost,
    LOGICAL_OR(n = 'death') AS died,
    MAX(IF(n = 'match_start', party, NULL)) AS party,
    DATE(MIN(timestamp), 'America/New_York') AS day,
    MIN(timestamp) AS first_seen,
    MAX(timestamp) AS last_seen
  FROM events
  WHERE sid IS NOT NULL
  GROUP BY sid
)
SELECT
  s.player AS vid,
  COUNT(*) AS sessions,
  COUNT(DISTINCT s.day) AS days,
  IFNULL(ANY_VALUE(v.days), 0) > 1 AS returning,
  COUNTIF(s.played) AS played,
  COUNTIF(s.finished) AS finished,
  ROUND(MAX(s.farthest), 3) AS farthest,
  CASE WHEN LOGICAL_OR(s.won) THEN 'won' WHEN LOGICAL_OR(s.lost) THEN 'lost' END AS result,
  LOGICAL_OR(s.died) AS died,
  MAX(s.party) AS party,
  APPROX_QUANTILES(s.load_ms, 2)[OFFSET(1)] AS load_ms,
  APPROX_QUANTILES(s.median_fps, 2)[OFFSET(1)] AS fps,
  MAX(s.worst_ms) AS worst_frame_ms,
  ANY_VALUE(s.build HAVING MAX s.last_seen) AS build,
  ANY_VALUE(s.os HAVING MAX s.last_seen) AS os,
  ANY_VALUE(s.gpu HAVING MAX s.last_seen) AS gpu,
  ANY_VALUE(s.tier HAVING MAX s.last_seen) AS tier,
  ANY_VALUE(s.engine HAVING MAX s.last_seen) AS engine,
  NULLIF(ARRAY_AGG(IF(pl.country IS NULL, NULL, IFNULL(pl.city, '')) IGNORE NULLS ORDER BY s.last_seen DESC LIMIT 1)[SAFE_OFFSET(0)], '') AS city,
  NULLIF(ARRAY_AGG(IF(pl.country IS NULL, NULL, IFNULL(pl.region, '')) IGNORE NULLS ORDER BY s.last_seen DESC LIMIT 1)[SAFE_OFFSET(0)], '') AS region,
  NULLIF(ARRAY_AGG(IFNULL(pl.country, '') ORDER BY IF(pl.country IS NULL, 0, 1) DESC, s.last_seen DESC LIMIT 1)[SAFE_OFFSET(0)], '') AS country,
  MIN(s.first_seen) AS first_seen,
  MAX(s.last_seen) AS last_seen
FROM per_session s
LEFT JOIN places pl USING (sid)
LEFT JOIN visitor_days v ON v.vid = s.player
GROUP BY s.player
ORDER BY last_seen DESC
LIMIT 200;
