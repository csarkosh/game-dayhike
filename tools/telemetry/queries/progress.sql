-- Each match: how far the party got (p: 0 at the trailhead, 1 at the crest),
-- which acts they reached, whether the chase came, and how it ended. One
-- line a session and game, newest first. `left_by` is the first way out the
-- page reported (`end` is the page itself leaving, on pagehide); a match with
-- neither an outcome nor a way out was last heard from at `last_seen`, which
-- is how the page tells one still going from one that ended silently.
WITH events AS (
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
    JSON_VALUE(json_payload.self) AS self,
    CAST(JSON_VALUE(json_payload.party) AS INT64) AS party,
    CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
    CAST(JSON_VALUE(json_payload.t) AS INT64) AS t,
    timestamp
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) -- range
    AND JSON_VALUE(json_payload.build) != 'verify'
    AND JSON_VALUE(json_payload.game) IS NOT NULL
)
SELECT
  sid,
  game,
  build,
  world,
  MAX(IF(n = 'match_start', role, NULL)) AS role,
  MAX(IF(n = 'match_start', party, NULL)) AS party,
  ROUND(MAX(p), 3) AS farthest,
  LOGICAL_OR(n = 'act' AND act = 'wet') AS wet,
  LOGICAL_OR(n = 'act' AND act = 'dusk') AS dusk,
  LOGICAL_OR(n = 'act' AND act = 'mist') AS mist,
  LOGICAL_OR(n = 'phase' AND phase = 'scene') AS summit,
  LOGICAL_OR(n = 'phase' AND phase = 'chase') AS chase,
  LOGICAL_OR(n = 'death') AS died,
  MAX(IF(n = 'outcome', result, NULL)) AS result,
  MAX(IF(n = 'outcome', self, NULL)) AS self_at_end,
  ARRAY_AGG(
    IF(n IN ('exit', 'session_end', 'host_session_end', 'match_end', 'continue_offline', 'lobby_end', 'end'), n, NULL)
    IGNORE NULLS ORDER BY t LIMIT 1
  )[SAFE_OFFSET(0)] AS left_by,
  (MAX(t) - MIN(IF(n = 'match_start', t, NULL))) / 60000 AS minutes,
  MIN(timestamp) AS started_at,
  MAX(timestamp) AS last_seen
FROM events
GROUP BY sid, game, build, world
ORDER BY started_at DESC;
