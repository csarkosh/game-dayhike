-- Machines: one row per graphics chip, phone or not, and quality tier over
-- the days asked (the admin page's Machines and tiers card): how many players and
-- sessions were on that tier, the median frame rate with how many sessions
-- were good (50 or more), slow (30 to 50) or bad (under 30) by the median of
-- their own heartbeats (`hb`) on it, the sessions with no heartbeat on it,
-- the median load, how many the auto choice put there, the cores and memory
-- most often seen, and the systems. A player is a `vid` (a session whose
-- storage refused the id stands alone under its `sid`).
-- The tier in force is the one a row was sent under: the `load` row's tier,
-- then a `tier_fallback`'s built tier (not when it built `none`), then each
-- `tier_change`'s `to`, read in order (`timestamp`, then `t`); the source in
-- force is the `load` row's and each `tier_change`'s. A session counts under
-- every tier it had a load, a `ready` or a heartbeat on, and its load time
-- (the `load` row's decision, engine and build, then `ready`'s `ms`) under
-- the tier in force when `ready` arrived, as the page's profile does. The
-- graphics chip's name is trimmed of a `(0x...)` device id and of anything from
-- Direct3D, OpenGL or Vulkan on, so one chip's driver strings meet; `gpu` is
-- '' where the browser did not share it. Left out: rows with no tier in
-- force (a session before its `load` row), and the rest of what `real`
-- drops.
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
    JSON_VALUE(json_payload.gpu) AS gpu,
    IFNULL(JSON_VALUE(json_payload.mobile), '') = 'true' AS mobile,
    SAFE_CAST(JSON_VALUE(json_payload.cores) AS INT64) AS cores,
    SAFE_CAST(JSON_VALUE(json_payload.mem) AS INT64) AS mem,
    JSON_VALUE(json_payload.os) AS os,
    JSON_VALUE(json_payload.tier) AS tier,
    JSON_VALUE(json_payload.source) AS source,
    NULLIF(JSON_VALUE(json_payload.built), 'none') AS built,
    JSON_VALUE(json_payload, '$.to') AS to_tier,
    IFNULL(SAFE_CAST(JSON_VALUE(json_payload.decideMs) AS INT64), 0) + IFNULL(SAFE_CAST(JSON_VALUE(json_payload.engineMs) AS INT64), 0) + IFNULL(SAFE_CAST(JSON_VALUE(json_payload.buildMs) AS INT64), 0) AS load_part,
    SAFE_CAST(JSON_VALUE(json_payload.ms) AS INT64) AS ready_ms,
    SAFE_CAST(JSON_VALUE(json_payload.fps) AS FLOAT64) AS fps,
    SAFE_CAST(JSON_VALUE(json_payload.t) AS INT64) AS t,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
    AND JSON_VALUE(json_payload.sid) IS NOT NULL
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
),
-- Each row with the tier and the source in force when it was sent.
stamped AS (
  SELECT
    *,
    LAST_VALUE(CASE n WHEN 'load' THEN tier WHEN 'tier_fallback' THEN built WHEN 'tier_change' THEN to_tier END IGNORE NULLS)
      OVER (PARTITION BY sid ORDER BY timestamp, t ROWS UNBOUNDED PRECEDING) AS tier_now,
    LAST_VALUE(CASE n WHEN 'load' THEN source WHEN 'tier_change' THEN source END IGNORE NULLS)
      OVER (PARTITION BY sid ORDER BY timestamp, t ROWS UNBOUNDED PRECEDING) AS source_now,
    MAX(IF(n = 'load', load_part, NULL)) OVER (PARTITION BY sid) AS session_load_part
  FROM events
),
-- One line a session on a tier: what it did there.
per_tier AS (
  SELECT
    sid,
    tier_now AS tier,
    IFNULL(NULLIF(ANY_VALUE(vid), ''), sid) AS player,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(IFNULL(MAX(gpu), ''), r'\s*\(0x[0-9a-fA-F]+\)', ''), r'\s+(Direct3D|OpenGL|Vulkan).*$', '')) AS gpu,
    LOGICAL_OR(mobile) AS mobile,
    MAX(cores) AS cores,
    MAX(mem) AS mem,
    MAX(os) AS os,
    ANY_VALUE(source_now HAVING MAX timestamp) AS source,
    MAX(IF(n = 'ready', IFNULL(session_load_part, 0) + ready_ms, NULL)) AS load_ms,
    APPROX_QUANTILES(IF(n = 'hb', fps, NULL), 2)[OFFSET(1)] AS median_fps
  FROM stamped
  WHERE tier_now IS NOT NULL
    AND n IN ('load', 'ready', 'hb')
  GROUP BY sid, tier_now
)
SELECT
  gpu,
  mobile,
  tier,
  COUNT(DISTINCT player) AS players,
  COUNT(*) AS sessions,
  APPROX_QUANTILES(median_fps, 2)[OFFSET(1)] AS fps,
  COUNTIF(median_fps >= 50) AS good,
  COUNTIF(median_fps >= 30 AND median_fps < 50) AS slow,
  COUNTIF(median_fps < 30) AS bad,
  COUNTIF(median_fps IS NULL) AS no_frames,
  APPROX_QUANTILES(load_ms, 2)[OFFSET(1)] AS load_ms,
  COUNTIF(source = 'auto') AS auto_sessions,
  IFNULL(APPROX_TOP_COUNT(IF(cores > 0, cores, NULL), 2)[OFFSET(0)].value, APPROX_TOP_COUNT(IF(cores > 0, cores, NULL), 2)[SAFE_OFFSET(1)].value) AS cores,
  IFNULL(APPROX_TOP_COUNT(IF(mem > 0, mem, NULL), 2)[OFFSET(0)].value, APPROX_TOP_COUNT(IF(mem > 0, mem, NULL), 2)[SAFE_OFFSET(1)].value) AS mem,
  STRING_AGG(DISTINCT os ORDER BY os) AS oses
FROM per_tier
GROUP BY gpu, mobile, tier
ORDER BY players DESC, sessions DESC, gpu, tier
LIMIT 100;
