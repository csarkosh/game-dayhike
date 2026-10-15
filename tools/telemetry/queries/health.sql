-- Health: load times by tier and engine (the laps of the start chain), the
-- heartbeat's frame rate and worst frame, and how sessions ended. A session
-- that said goodbye (an `end` row) is clean where its `trouble` was 0 and
-- troubled otherwise; one without an `end` row is unknown. Of the sessions
-- that played and never said goodbye, one whose last `visibility` was
-- `hidden` went to the background (a tab switched away and never came back
-- to say so); the rest ended silently (the page died, or the beacon never
-- left).
-- The rows that are real play, the same text in every query (`README.md`):
-- not the deploy's verification (`build = 'verify'` on a page's rows,
-- `verify` on signaling's), not the owner's test browsers (`tester`), not a
-- session of the README's stills shoot (one with a `cmd` row, looked for over
-- the last ninety days), not a headless browser (a `SwiftShader` GPU).
WITH real AS (
  SELECT timestamp, json_payload
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE IFNULL(JSON_VALUE(json_payload.build), '') != 'verify'
    AND IFNULL(JSON_VALUE(json_payload.tester), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.verify), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.gpu), '') NOT LIKE '%SwiftShader%'
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
    JSON_VALUE(json_payload.tier) AS tier,
    JSON_VALUE(json_payload.engine) AS engine,
    JSON_VALUE(json_payload.os) AS os,
    JSON_VALUE(json_payload.state) AS state,
    CAST(JSON_VALUE(json_payload.decideMs) AS INT64) AS decide_ms,
    CAST(JSON_VALUE(json_payload.engineMs) AS INT64) AS engine_ms,
    CAST(JSON_VALUE(json_payload.buildMs) AS INT64) AS build_ms,
    CAST(JSON_VALUE(json_payload.ms) AS INT64) AS ready_ms,
    CAST(JSON_VALUE(json_payload.fps) AS FLOAT64) AS fps,
    CAST(JSON_VALUE(json_payload.worst) AS INT64) AS worst_ms,
    CAST(JSON_VALUE(json_payload.stalls) AS INT64) AS stalls,
    CAST(JSON_VALUE(json_payload.trouble) AS INT64) AS trouble,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
),
per_session AS (
  SELECT
    sid,
    ANY_VALUE(build) AS build,
    ANY_VALUE(os) AS os,
    MAX(IF(n = 'load', tier, NULL)) AS tier,
    MAX(IF(n = 'load', engine, NULL)) AS engine,
    MAX(IF(n = 'load', decide_ms, NULL)) AS decide_ms,
    MAX(IF(n = 'load', engine_ms, NULL)) AS engine_ms,
    MAX(IF(n = 'load', build_ms, NULL)) AS build_ms,
    MAX(IF(n = 'ready', ready_ms, NULL)) AS ready_ms,
    APPROX_QUANTILES(IF(n = 'hb', fps, NULL), 2)[OFFSET(1)] AS median_fps,
    MAX(IF(n = 'hb', worst_ms, NULL)) AS worst_ms,
    SUM(IF(n = 'hb', stalls, 0)) AS stalls,
    LOGICAL_OR(n = 'end') AS said_goodbye,
    MAX(IF(n = 'end', trouble, NULL)) AS trouble,
    ARRAY_AGG(IF(n = 'visibility', state, NULL) IGNORE NULLS ORDER BY timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_state,
    LOGICAL_OR(n = 'match_start') AS played
  FROM events
  GROUP BY sid
)
SELECT
  build,
  tier,
  engine,
  COUNT(*) AS sessions,
  COUNTIF(played) AS played,
  COUNTIF(said_goodbye) AS ended,
  COUNTIF(said_goodbye AND trouble = 0) AS clean,
  COUNTIF(said_goodbye AND trouble > 0) AS troubled,
  COUNTIF(NOT said_goodbye) AS unknown,
  COUNTIF(played AND NOT said_goodbye AND last_state = 'hidden') AS backgrounded,
  COUNTIF(played AND NOT said_goodbye AND IFNULL(last_state, '') != 'hidden') AS ended_silently,
  APPROX_QUANTILES(decide_ms + engine_ms + build_ms, 10)[OFFSET(5)] AS p50_start_ms,
  APPROX_QUANTILES(decide_ms + engine_ms + build_ms, 10)[OFFSET(9)] AS p90_start_ms,
  APPROX_QUANTILES(ready_ms, 10)[OFFSET(5)] AS p50_ready_ms,
  APPROX_QUANTILES(median_fps, 10)[OFFSET(5)] AS p50_fps,
  APPROX_QUANTILES(worst_ms, 10)[OFFSET(9)] AS p90_worst_frame_ms
FROM per_session
GROUP BY build, tier, engine
ORDER BY build DESC, tier, engine;
