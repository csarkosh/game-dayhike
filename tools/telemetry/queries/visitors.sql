-- Visitors: one line a browser (`vid`) over the range, the most recently seen
-- first: how many sessions it had and on how many New York days, how many of
-- them played a match and reached an outcome, the build and machine it was
-- last seen on, and its last session, which the admin page opens. A browser
-- whose storage refused the id is not here.
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
    JSON_VALUE(json_payload.vid) AS vid,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.os) AS os,
    JSON_VALUE(json_payload.browser) AS browser,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
    AND IFNULL(JSON_VALUE(json_payload.vid), '') != ''
)
SELECT
  vid,
  COUNT(DISTINCT sid) AS sessions,
  COUNT(DISTINCT DATE(timestamp, 'America/New_York')) AS days,
  COUNT(DISTINCT IF(n = 'match_start', sid, NULL)) AS played,
  COUNT(DISTINCT IF(n = 'outcome', sid, NULL)) AS finished,
  ANY_VALUE(build HAVING MAX timestamp) AS build,
  ANY_VALUE(CONCAT(IFNULL(os, ''), ' ', IFNULL(browser, '')) HAVING MAX timestamp) AS machine,
  ANY_VALUE(sid HAVING MAX timestamp) AS last_sid,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen
FROM events
GROUP BY vid
ORDER BY last_seen DESC
LIMIT 200;
