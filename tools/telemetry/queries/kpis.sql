-- The index card (the admin host's front page, `GET /admin/kpis`) and the
-- page's Visitors card: sessions, matches, sessions that ended clean, sessions
-- that hit an error, visitors and returning visitors, one row a period. The
-- periods are the ISO weeks of the range by the day a session started
-- (`kind = 'week'`, `week_start` its Monday), the last seven days against the
-- seven before (`kind = 'window'`, `period` 'current' or 'previous'), and the
-- whole range read (`kind = 'range'`, `period` 'all'). Every day and week is
-- New York's when pasted, and the viewer's zone (the route's `tz`) from the
-- admin routes and the index card.
-- A session counts where it has a `page` row; a match is a distinct `game`
-- with a host's `match_start`, in the period that row fell in; clean where
-- the session's `end` row said `trouble` 0, of the sessions that have one;
-- erred where any row of it is an error or a failed start; a visitor is a
-- distinct `vid`, and returning where that browser was seen on more than one
-- day in the last ninety. The range is twelve weeks, the trend's length.
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
    IFNULL(JSON_VALUE(json_payload.vid), '') AS vid,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.role) AS role,
    JSON_VALUE(json_payload.game) AS game,
    CAST(JSON_VALUE(json_payload.trouble) AS INT64) AS trouble,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 84 DAY), 'America/New_York') -- range
),
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
per_session AS (
  SELECT
    sid,
    ANY_VALUE(vid) AS vid,
    DATE(MIN(timestamp), 'America/New_York') AS day,
    LOGICAL_OR(n = 'page') AS landed,
    LOGICAL_OR(n = 'end') AS said_goodbye,
    MAX(IF(n = 'end', trouble, NULL)) AS trouble,
    LOGICAL_OR(n IN ('error', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed')) AS erred
  FROM events
  GROUP BY sid
),
per_match AS (
  SELECT game, DATE(MIN(timestamp), 'America/New_York') AS day
  FROM events
  WHERE n = 'match_start' AND role = 'host' AND game IS NOT NULL
  GROUP BY game
),
-- Every day anything happened on, in each period it falls in.
periods AS (
  SELECT period.kind, period.period, period.week_start, day
  FROM (
    SELECT DISTINCT day FROM per_session
    UNION DISTINCT
    SELECT DISTINCT day FROM per_match
  ), UNNEST([
    STRUCT('week' AS kind, FORMAT_DATE('%G-W%V', day) AS period, DATE_TRUNC(day, ISOWEEK) AS week_start),
    STRUCT('window', CASE WHEN DATE_DIFF(CURRENT_DATE('America/New_York'), day, DAY) < 7 THEN 'current' WHEN DATE_DIFF(CURRENT_DATE('America/New_York'), day, DAY) < 14 THEN 'previous' END, CAST(NULL AS DATE)),
    STRUCT('range', 'all', CAST(NULL AS DATE))
  ]) AS period
  WHERE period.period IS NOT NULL
),
sessions_by AS (
  SELECT
    p.kind,
    p.period,
    p.week_start,
    COUNTIF(s.landed) AS sessions,
    COUNTIF(s.landed AND s.said_goodbye) AS ended,
    COUNTIF(s.landed AND s.trouble = 0) AS clean,
    COUNTIF(s.landed AND s.erred) AS erred,
    COUNT(DISTINCT IF(s.landed AND s.vid != '', s.vid, NULL)) AS visitors,
    COUNT(DISTINCT IF(s.landed AND s.vid != '' AND IFNULL(v.days, 0) > 1, s.vid, NULL)) AS returning
  FROM per_session s
  JOIN periods p USING (day)
  LEFT JOIN visitor_days v USING (vid)
  GROUP BY kind, period, week_start
),
matches_by AS (
  SELECT p.kind, p.period, COUNT(DISTINCT m.game) AS matches
  FROM per_match m
  JOIN periods p USING (day)
  GROUP BY kind, period
)
SELECT
  s.kind,
  s.period,
  s.week_start,
  s.sessions,
  IFNULL(m.matches, 0) AS matches,
  s.ended,
  s.clean,
  s.erred,
  s.visitors,
  s.returning
FROM sessions_by s
LEFT JOIN matches_by m USING (kind, period)
ORDER BY kind, week_start, period;
