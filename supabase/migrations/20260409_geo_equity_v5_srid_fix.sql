-- Geo-Equity v5: Fix SRID 3857 → 4326 for all geometry columns
-- geom_z7 and geom_z10 in iris are SRID 3857 (Web Mercator)
-- MapLibre expects SRID 4326 (WGS84)

-- Fix ref tables (pre-computed from geom_z7/z10 which are 3857)
UPDATE ref_regions SET geom = ST_Transform(geom, 4326) WHERE ST_SRID(geom) = 3857;
UPDATE ref_departements SET geom = ST_Transform(geom, 4326) WHERE ST_SRID(geom) = 3857;
UPDATE ref_communes SET geom = ST_Transform(geom, 4326) WHERE ST_SRID(geom) = 3857;

-- RPCs updated to use ST_Transform(geom_z7, 4326) in full IRIS mode
-- See get_equity_analysis and get_campaign_impressions functions
