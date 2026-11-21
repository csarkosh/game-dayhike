-- Places: where Day Hike's visitors are, one line a city, from csarko.sh's
-- analytics (lib-visits, which the game's pages report to: `index.html`)
-- rather than this game's own telemetry. The collector looks each address up
-- in its bundled city database (DB-IP's IP to City Lite) and writes the
-- country (`s.cc`), the region (`s.rg`), the city (`s.ct`) and the city's
-- coordinates (`s.la`, `s.lo`, to a tenth of a degree), never the address. A visit (`s.visit`, the collector's daily hash) counts once, at the
-- place it was first seen in; it played when it reached a game's page
-- (`/dayhike/game/<id>`). Rows from before the collector had the database
-- carry no place and are counted as one line with no city. The collector's
-- bot flag and its deploy checks are left out, and so is the owner, whose
-- beacons the collector never writes (`--ignore-ips`).
WITH views AS (
  SELECT
    COALESCE(JSON_VALUE(json_payload.s.visit), JSON_VALUE(json_payload.id)) AS visit,
    JSON_VALUE(json_payload.p) AS path,
    JSON_VALUE(json_payload.s.cc) AS country,
    JSON_VALUE(json_payload.s.rg) AS region,
    JSON_VALUE(json_payload.s.ct) AS city,
    SAFE_CAST(JSON_VALUE(json_payload.s.la) AS FLOAT64) AS lat,
    SAFE_CAST(JSON_VALUE(json_payload.s.lo) AS FLOAT64) AS lon,
    timestamp
  FROM `csarko-sh.csarko_visits._AllLogs`
  WHERE JSON_VALUE(json_payload.n) = 'view'
    AND JSON_VALUE(json_payload.s.host) = 'games.csarko.sh'
    AND STARTS_WITH(JSON_VALUE(json_payload.p), '/dayhike/')
    AND IFNULL(JSON_VALUE(json_payload.s.bot), 'false') != 'true'
    AND timestamp >= TIMESTAMP(DATE_SUB(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), INTERVAL 7 DAY), 'America/New_York') -- range
),
per_visit AS (
  SELECT
    visit,
    ANY_VALUE(country HAVING MIN timestamp) AS country,
    ANY_VALUE(region HAVING MIN timestamp) AS region,
    ANY_VALUE(city HAVING MIN timestamp) AS city,
    ANY_VALUE(lat HAVING MIN timestamp) AS lat,
    ANY_VALUE(lon HAVING MIN timestamp) AS lon,
    LOGICAL_OR(STARTS_WITH(path, '/dayhike/game/')) AS played,
    MAX(timestamp) AS last_seen
  FROM views
  GROUP BY visit
)
SELECT
  city,
  region,
  country,
  ROUND(AVG(lat), 1) AS lat,
  ROUND(AVG(lon), 1) AS lon,
  COUNT(*) AS visits,
  COUNTIF(played) AS played,
  MAX(last_seen) AS last_seen
FROM per_visit
GROUP BY city, region, country
ORDER BY visits DESC, last_seen DESC
LIMIT 100;
