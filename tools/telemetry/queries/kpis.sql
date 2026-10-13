-- The index card (the admin host's front page, `GET /admin/kpis`): sessions,
-- matches started, sessions that ended clean and sessions that hit an error,
-- one row a period. The periods are the ISO weeks of the range, by the week a
-- session started (`kind = 'week'`, `week_start` its Monday), and the last
-- seven days against the seven before (`kind = 'window'`, `period` 'current'
-- or 'previous'). A session counts where it has a `page` row; a match where
-- the session has a `match_start` row; clean where its `end` row's `trouble`
-- is 0, over the sessions that have an `end` row; erred where any row of it
-- is an error or a failed start. The range is twelve weeks, the trend's length.
WITH events AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.n) AS n,
    CAST(JSON_VALUE(json_payload.trouble) AS INT64) AS trouble,
    timestamp
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 84 DAY) -- range
    AND JSON_VALUE(json_payload.build) != 'verify'
),
per_session AS (
  SELECT
    sid,
    MIN(timestamp) AS started_at,
    LOGICAL_OR(n = 'page') AS landed,
    COUNTIF(n = 'match_start') AS matches,
    LOGICAL_OR(n = 'end') AS said_goodbye,
    MAX(IF(n = 'end', trouble, NULL)) AS trouble,
    LOGICAL_OR(n IN ('error', 'start_fail', 'connect_fail', 'engine_failed', 'webgpu_start_failed')) AS erred
  FROM events
  GROUP BY sid
),
by_week AS (
  SELECT
    'week' AS kind,
    FORMAT_DATE('%G-W%V', DATE(started_at)) AS period,
    DATE_TRUNC(DATE(started_at), ISOWEEK) AS week_start,
    COUNTIF(landed) AS sessions,
    SUM(IF(landed, matches, 0)) AS matches,
    COUNTIF(landed AND said_goodbye) AS ended,
    COUNTIF(landed AND trouble = 0) AS clean,
    COUNTIF(landed AND erred) AS erred
  FROM per_session
  GROUP BY period, week_start
),
by_window AS (
  SELECT
    'window' AS kind,
    IF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY), 'current', 'previous') AS period,
    CAST(NULL AS DATE) AS week_start,
    COUNTIF(landed) AS sessions,
    SUM(IF(landed, matches, 0)) AS matches,
    COUNTIF(landed AND said_goodbye) AS ended,
    COUNTIF(landed AND trouble = 0) AS clean,
    COUNTIF(landed AND erred) AS erred
  FROM per_session
  WHERE started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
  GROUP BY period
)
SELECT kind, period, week_start, sessions, matches, ended, clean, erred FROM by_week
UNION ALL
SELECT kind, period, week_start, sessions, matches, ended, clean, erred FROM by_window
ORDER BY kind, week_start, period;
