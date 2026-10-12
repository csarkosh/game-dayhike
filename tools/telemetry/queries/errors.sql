-- What threw: errors and warnings by their text, where the page was, and on
-- which build; how many sessions each touched. The text is cut to its first
-- hundred characters so a message with a variable tail groups as one.
WITH rows AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.kind) AS kind,
    JSON_VALUE(json_payload.where) AS at_page,
    SUBSTR(JSON_VALUE(json_payload.msg), 1, 100) AS msg,
    JSON_VALUE(json_payload.os) AS os,
    JSON_VALUE(json_payload.browser) AS browser,
    JSON_VALUE(json_payload.gpu) AS gpu,
    timestamp
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) -- range
    AND JSON_VALUE(json_payload.n) IN ('error', 'warn', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed', 'tier_fallback')
    AND JSON_VALUE(json_payload.build) != 'verify'
)
SELECT
  n,
  kind,
  at_page,
  msg,
  build,
  COUNT(*) AS times,
  COUNT(DISTINCT sid) AS sessions,
  ANY_VALUE(sid) AS a_session,
  ANY_VALUE(CONCAT(os, ' ', browser, ' ', gpu)) AS a_machine,
  MAX(timestamp) AS last_seen
FROM rows
GROUP BY n, kind, at_page, msg, build
ORDER BY sessions DESC, last_seen DESC;
