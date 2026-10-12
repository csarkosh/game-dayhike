-- Health: load times by tier and engine (the laps of the start chain), the
-- heartbeat's frame rate and worst frame, and how sessions ended — with an
-- `end` row (the page said goodbye) or without one (it died, or the beacon
-- never left).
WITH rows AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.tier) AS tier,
    JSON_VALUE(json_payload.engine) AS engine,
    JSON_VALUE(json_payload.os) AS os,
    CAST(JSON_VALUE(json_payload.decideMs) AS INT64) AS decide_ms,
    CAST(JSON_VALUE(json_payload.engineMs) AS INT64) AS engine_ms,
    CAST(JSON_VALUE(json_payload.buildMs) AS INT64) AS build_ms,
    CAST(JSON_VALUE(json_payload.ms) AS INT64) AS ready_ms,
    CAST(JSON_VALUE(json_payload.fps) AS FLOAT64) AS fps,
    CAST(JSON_VALUE(json_payload.worst) AS INT64) AS worst_ms,
    CAST(JSON_VALUE(json_payload.stalls) AS INT64) AS stalls,
    CAST(JSON_VALUE(json_payload.trouble) AS INT64) AS trouble
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) -- range
    AND JSON_VALUE(json_payload.build) != 'verify'
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
    LOGICAL_OR(n = 'match_start') AS played
  FROM rows
  GROUP BY sid
)
SELECT
  build,
  tier,
  engine,
  COUNT(*) AS sessions,
  COUNTIF(played) AS played,
  COUNTIF(played AND NOT said_goodbye) AS ended_silently,
  COUNTIF(trouble = 0) AS clean,
  APPROX_QUANTILES(decide_ms + engine_ms + build_ms, 10)[OFFSET(5)] AS p50_start_ms,
  APPROX_QUANTILES(decide_ms + engine_ms + build_ms, 10)[OFFSET(9)] AS p90_start_ms,
  APPROX_QUANTILES(ready_ms, 10)[OFFSET(5)] AS p50_ready_ms,
  APPROX_QUANTILES(median_fps, 10)[OFFSET(5)] AS p50_fps,
  APPROX_QUANTILES(worst_ms, 10)[OFFSET(9)] AS p90_worst_frame_ms
FROM per_session
GROUP BY build, tier, engine
ORDER BY build DESC, tier, engine;
