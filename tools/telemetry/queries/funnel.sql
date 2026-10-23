-- The funnel: of the sessions in the range, how many landed (rendered a
-- route), pressed Play, started a match and reached an outcome. The stages
-- nest per session over the whole range: a session counts at a stage only
-- where it counted at the one before, so each number is at most the last.
-- One line a build, newest first, and one line `all` over every build, the
-- headline; a session is on the build of its last row.
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
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
),
per_session AS (
  SELECT
    sid,
    ANY_VALUE(build HAVING MAX timestamp) AS build,
    LOGICAL_OR(n = 'page') AS landed,
    LOGICAL_OR(n = 'play') AS played,
    LOGICAL_OR(n = 'match_start') AS started,
    LOGICAL_OR(n = 'outcome') AS finished,
    MIN(timestamp) AS first_seen,
    MAX(timestamp) AS last_seen
  FROM events
  GROUP BY sid
),
nested AS (
  SELECT
    sid,
    build,
    landed,
    landed AND played AS pressed_play,
    landed AND played AND started AS started,
    landed AND played AND started AND finished AS finished,
    first_seen,
    last_seen
  FROM per_session
)
SELECT
  grp AS build,
  COUNTIF(landed) AS landed,
  COUNTIF(pressed_play) AS pressed_play,
  COUNTIF(started) AS started,
  COUNTIF(finished) AS finished,
  COUNT(*) AS sessions,
  MIN(first_seen) AS first_seen,
  MAX(last_seen) AS last_seen
FROM nested, UNNEST([nested.build, 'all']) AS grp
GROUP BY grp
ORDER BY IF(grp = 'all', 0, 1), last_seen DESC;
