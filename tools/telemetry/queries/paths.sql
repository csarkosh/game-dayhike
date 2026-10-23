-- Where players went, one world at a time: every position sample (a row every
-- two seconds of sim time while the player moved: position, yaw, the climb,
-- health, the lamp, sprinting, how far off the trail, the dread lens, the
-- Hollow's closeness, the stare) and the route's events between them (the
-- nearest trail edge changing, a fork reached, a named place entered or left,
-- the trail left or regained, the lamp, a death, the Hollow first seen, the
-- chase's cuts, the poster read). The seed is the world's, so samples from
-- different worlds of one version do not overlay. The admin page draws these
-- over the trail it rebuilds from the seed.
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
samples AS (
  SELECT
    JSON_VALUE(json_payload.world) AS world,
    CAST(JSON_VALUE(json_payload.seed) AS INT64) AS seed,
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.n) AS n,
    CAST(JSON_VALUE(json_payload.tick) AS INT64) AS tick,
    CAST(JSON_VALUE(json_payload.x) AS FLOAT64) AS x,
    CAST(JSON_VALUE(json_payload.z) AS FLOAT64) AS z,
    CAST(JSON_VALUE(json_payload.yaw) AS FLOAT64) AS yaw,
    CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
    CAST(JSON_VALUE(json_payload.hp) AS FLOAT64) AS hp,
    JSON_VALUE(json_payload.lamp) AS lamp,
    JSON_VALUE(json_payload.sprint) AS sprint,
    CAST(JSON_VALUE(json_payload.off) AS FLOAT64) AS off,
    CAST(JSON_VALUE(json_payload.lens) AS FLOAT64) AS lens,
    CAST(JSON_VALUE(json_payload.near) AS FLOAT64) AS near,
    CAST(JSON_VALUE(json_payload.stare) AS FLOAT64) AS stare,
    CAST(JSON_VALUE(json_payload.edge) AS INT64) AS edge,
    JSON_VALUE(json_payload.kind) AS kind,
    CAST(JSON_VALUE(json_payload.node) AS INT64) AS node,
    CAST(JSON_VALUE(json_payload.id) AS INT64) AS id,
    JSON_VALUE(json_payload.name) AS name,
    JSON_VALUE(json_payload.in) AS in_place,
    JSON_VALUE(json_payload.on) AS lamp_on,
    CAST(JSON_VALUE(json_payload.open) AS INT64) AS open_branch,
    JSON_VALUE(json_payload.role) AS role,
    JSON_VALUE(json_payload.result) AS result,
    JSON_VALUE(json_payload.build) AS build,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
    AND JSON_VALUE(json_payload.n) IN ('pos', 'edge', 'fork', 'place', 'offtrail', 'ontrail', 'lamp', 'death', 'hollow_seen', 'cut', 'poster', 'match_start', 'outcome')
    AND JSON_VALUE(json_payload.seed) IS NOT NULL
)
SELECT * FROM samples
ORDER BY world, seed, sid, tick;
