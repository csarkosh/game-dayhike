-- What threw: errors and warnings by their text, where the page was, and on
-- which build; how many sessions each touched. The text is cut to its first
-- hundred characters so a message with a variable tail groups as one.
-- `level` tells an error (a throw, a failed start or connection, an engine
-- that would not build) from a warning (`warn`, a tier fallen back to);
-- `sessions` is distinct per line, and `sessions_with_errors` and
-- `sessions_with_warnings`, the same on every line, are distinct over the
-- whole range, so a session with two problems is counted once there.
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
    IF(JSON_VALUE(json_payload.n) IN ('error', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed'), 'error', 'warning') AS level,
    JSON_VALUE(json_payload.kind) AS kind,
    JSON_VALUE(json_payload.where) AS at_page,
    SUBSTR(JSON_VALUE(json_payload.msg), 1, 100) AS msg,
    JSON_VALUE(json_payload.os) AS os,
    JSON_VALUE(json_payload.browser) AS browser,
    JSON_VALUE(json_payload.gpu) AS gpu,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP_SUB(TIMESTAMP(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), 'America/New_York'), INTERVAL 7 DAY) -- range
    AND JSON_VALUE(json_payload.n) IN ('error', 'warn', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed', 'tier_fallback')
),
totals AS (
  SELECT
    COUNT(DISTINCT IF(level = 'error', sid, NULL)) AS sessions_with_errors,
    COUNT(DISTINCT IF(level = 'warning', sid, NULL)) AS sessions_with_warnings
  FROM events
)
SELECT
  level,
  n,
  kind,
  at_page,
  msg,
  build,
  COUNT(*) AS times,
  COUNT(DISTINCT sid) AS sessions,
  ANY_VALUE(sid) AS a_session,
  ANY_VALUE(CONCAT(os, ' ', browser, ' ', gpu)) AS a_machine,
  MAX(timestamp) AS last_seen,
  ANY_VALUE(totals.sessions_with_errors) AS sessions_with_errors,
  ANY_VALUE(totals.sessions_with_warnings) AS sessions_with_warnings
FROM events, totals
GROUP BY level, n, kind, at_page, msg, build
ORDER BY IF(level = 'error', 0, 1), sessions DESC, last_seen DESC;
