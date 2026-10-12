-- The funnel: sessions that landed, pressed Play, started a match, reached an
-- outcome; one line a build and world version, newest first.
WITH rows AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.world) AS world,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.kind) AS kind,
    timestamp
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND JSON_VALUE(json_payload.build) != 'verify'
)
SELECT
  build,
  COUNT(DISTINCT IF(n = 'page' AND kind = 'landing', sid, NULL)) AS landed,
  COUNT(DISTINCT IF(n = 'play', sid, NULL)) AS pressed_play,
  COUNT(DISTINCT IF(n = 'match_start', sid, NULL)) AS started,
  COUNT(DISTINCT IF(n = 'outcome', sid, NULL)) AS finished,
  COUNT(DISTINCT sid) AS sessions,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen
FROM rows
GROUP BY build
ORDER BY last_seen DESC;
