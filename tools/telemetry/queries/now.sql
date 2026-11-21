-- Now: the sessions playing this moment, for the admin page's indicator. A
-- session in a match sends a heartbeat (`hb`) every 30 s, so one heard from in
-- the last two minutes (four heartbeats) is still playing; a solo hike opens
-- no lobby, so signaling's rooms alone would miss it. One line a session: its
-- player (`vid`), build, tier, how far up it is (`p`, 0 at the trailhead and
-- 1 at the crest), its frame rate at the last heartbeat, and when it was last
-- heard from. No range: it always reads the last two minutes.
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
beats AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    JSON_VALUE(json_payload.vid) AS vid,
    JSON_VALUE(json_payload.build) AS build,
    JSON_VALUE(json_payload.tier) AS tier,
    CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
    CAST(JSON_VALUE(json_payload.fps) AS FLOAT64) AS fps,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND JSON_VALUE(json_payload.n) = 'hb'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 MINUTE)
)
SELECT
  sid,
  ANY_VALUE(vid) AS vid,
  ANY_VALUE(build) AS build,
  ANY_VALUE(tier) AS tier,
  ANY_VALUE(p HAVING MAX timestamp) AS p,
  ANY_VALUE(fps HAVING MAX timestamp) AS fps,
  MAX(timestamp) AS heard_at
FROM beats
WHERE sid IS NOT NULL
GROUP BY sid
ORDER BY heard_at DESC
LIMIT 50;
