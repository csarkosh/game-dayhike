-- What threw: errors and warnings by their text, where the page was, and on
-- which build; how many sessions each touched. The text is cut to its first
-- hundred characters so a message with a variable tail groups as one.
-- `level` tells an error (a throw, a failed start or connection, an engine
-- that would not build, a lost device, a hike ended by its lost devices)
-- from a warning (`warn`, a tier fallen back to). A GPU error under a hike
-- (`gpu_error`, its `kind` validation, out-of-memory or internal) is a
-- warning where the picture held after it and an error where it broke: the
-- window that judged the picture (`gpu_window`, `picture`) says which, and
-- an error's row names the window it fell in (`w`, numbered within a match);
-- `sessions` is distinct per line, and `sessions_with_errors` and
-- `sessions_with_warnings`, the same on every line, are distinct over the
-- whole range, so a session with two problems is counted once there. `whose`
-- is `players` or `you`: the owner's own play (`owner`, marked at the server by
-- address) is out of every count on the page, but the errors it meets are the
-- first anyone sees, so they are here too, on rows of their own and out of the
-- totals (Cyrus, 2026-11-01).
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
-- The owner's own sessions: every row the server marked `owner`, less the deploy's verification.
owner AS (
  SELECT timestamp, json_payload
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE IFNULL(JSON_VALUE(json_payload.owner), '') = 'true'
    AND IFNULL(JSON_VALUE(json_payload.build), '') != 'verify'
    AND IFNULL(JSON_VALUE(json_payload.verify), '') != 'true'
),
play AS (
  SELECT timestamp, json_payload, 'players' AS whose FROM real
  UNION ALL
  SELECT timestamp, json_payload, 'you' AS whose FROM owner
),
-- The range's rows that say something went wrong, with what tells how a GPU
-- error came out: the window it fell in, and that window's verdict.
ranged AS (
  SELECT
    whose,
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.kind) AS kind,
    JSON_VALUE(json_payload.where) AS at_page,
    SUBSTR(JSON_VALUE(json_payload.msg), 1, 100) AS msg,
    JSON_VALUE(json_payload.os) AS os,
    JSON_VALUE(json_payload.browser) AS browser,
    JSON_VALUE(json_payload.gpu) AS gpu,
    CONCAT(IFNULL(JSON_VALUE(json_payload.game), ''), '/', IFNULL(JSON_VALUE(json_payload.w), '')) AS judged,
    JSON_VALUE(json_payload.picture) AS picture,
    JSON_VALUE(json_payload.why) AS why,
    timestamp
  FROM play
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
    AND JSON_VALUE(json_payload.n) IN ('error', 'warn', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed', 'tier_fallback', 'gpu_error', 'gpu_window', 'device_lost', 'session_end')
),
-- The windows that found the picture broken.
broke AS (
  SELECT DISTINCT sid, judged
  FROM ranged
  WHERE n = 'gpu_window' AND picture = 'broke'
),
events AS (
  SELECT
    ranged.whose,
    ranged.sid,
    ranged.build,
    ranged.n,
    CASE
      WHEN ranged.n IN ('error', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed', 'device_lost', 'session_end') THEN 'error'
      WHEN ranged.n = 'gpu_error' AND broke.sid IS NOT NULL THEN 'error'
      ELSE 'warning'
    END AS level,
    ranged.kind,
    ranged.at_page,
    ranged.msg,
    ranged.os,
    ranged.browser,
    ranged.gpu,
    ranged.timestamp
  FROM ranged
  LEFT JOIN broke ON broke.sid = ranged.sid AND broke.judged = ranged.judged
  WHERE ranged.n IN ('error', 'warn', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed', 'tier_fallback', 'gpu_error', 'device_lost')
    OR (ranged.n = 'session_end' AND ranged.why = 'device_lost')
),
totals AS (
  SELECT
    COUNT(DISTINCT IF(level = 'error', sid, NULL)) AS sessions_with_errors,
    COUNT(DISTINCT IF(level = 'warning', sid, NULL)) AS sessions_with_warnings
  FROM events
  WHERE whose = 'players'
)
SELECT
  whose,
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
FROM events LEFT JOIN totals ON TRUE
GROUP BY whose, level, n, kind, at_page, msg, build
ORDER BY IF(level = 'error', 0, 1), IF(whose = 'players', 0, 1), sessions DESC, last_seen DESC;
