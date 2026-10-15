-- Each match: how far the party got (p: 0 at the trailhead, 1 at the crest),
-- which acts they reached, whether the chase came, and how it ended. One
-- line a match, newest first. A match is a distinct `game` with a host's
-- `match_start`; `sid` is that host's session; `players` the sessions with a
-- `match_start` for it; `minutes` the longest of its sessions' own
-- `match_end` or `outcome` minus `match_start`. `left_by` is the first way out
-- any of them reported (`end` is a page itself leaving, on pagehide); a match
-- with neither an outcome nor a way out was last heard from at `last_seen`,
-- which is how the page tells one still going from one that ended silently.
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
    JSON_VALUE(json_payload.game) AS game,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.world) AS world,
    JSON_VALUE(json_payload.role) AS role,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.act) AS act,
    JSON_VALUE(json_payload.phase) AS phase,
    JSON_VALUE(json_payload.result) AS result,
    CAST(JSON_VALUE(json_payload.party) AS INT64) AS party,
    CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP_SUB(TIMESTAMP(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), 'America/New_York'), INTERVAL 7 DAY) -- range
    AND JSON_VALUE(json_payload.game) IS NOT NULL
),
matches AS (
  SELECT
    game,
    MIN(timestamp) AS started_at,
    ANY_VALUE(sid HAVING MIN timestamp) AS sid
  FROM events
  WHERE n = 'match_start' AND role = 'host'
  GROUP BY game
),
-- Each session's own part of a match: from its match_start to its match_end or outcome.
parts AS (
  SELECT
    game,
    sid,
    LOGICAL_OR(n = 'match_start') AS played,
    TIMESTAMP_DIFF(MIN(IF(n IN ('match_end', 'outcome'), timestamp, NULL)), MIN(IF(n = 'match_start', timestamp, NULL)), MILLISECOND) AS length_ms
  FROM events
  GROUP BY game, sid
),
lengths AS (
  SELECT game, COUNT(DISTINCT IF(played, sid, NULL)) AS players, MAX(length_ms) AS length_ms
  FROM parts
  GROUP BY game
)
SELECT
  m.game,
  m.sid,
  ANY_VALUE(e.build) AS build,
  ANY_VALUE(e.world) AS world,
  ANY_VALUE(l.players) AS players,
  MAX(IF(e.n = 'match_start', e.party, NULL)) AS party,
  ROUND(MAX(e.p), 3) AS farthest,
  LOGICAL_OR(e.n = 'act' AND e.act = 'wet') AS wet,
  LOGICAL_OR(e.n = 'act' AND e.act = 'dusk') AS dusk,
  LOGICAL_OR(e.n = 'act' AND e.act = 'mist') AS mist,
  LOGICAL_OR(e.n = 'phase' AND e.phase = 'scene') AS summit,
  LOGICAL_OR(e.n = 'phase' AND e.phase = 'chase') AS chase,
  LOGICAL_OR(e.n = 'death') AS died,
  MAX(IF(e.n = 'outcome', e.result, NULL)) AS result,
  ARRAY_AGG(
    IF(e.n IN ('exit', 'session_end', 'host_session_end', 'match_end', 'continue_offline', 'lobby_end', 'end'), e.n, NULL)
    IGNORE NULLS ORDER BY e.timestamp LIMIT 1
  )[SAFE_OFFSET(0)] AS left_by,
  ROUND(ANY_VALUE(l.length_ms) / 60000, 1) AS minutes,
  m.started_at,
  MAX(e.timestamp) AS last_seen
FROM matches m
JOIN events e USING (game)
JOIN lengths l USING (game)
GROUP BY m.game, m.sid, m.started_at
ORDER BY m.started_at DESC;
