-- ============================================================
-- 085 — Table atmo_map_daily : indice ATMO national par code postal
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migration `atmo_map_daily`).
--
-- Même mécanique que pollen_map_daily (084) : ingestion bulk quotidienne
-- via le GeoServer WFS public Atmo (couche ind:ind_atmo, ~26 600 communes),
-- niveaux = MAX des communes du code postal, purge à J-2.
-- Les ~320 zones EPCI de la couche sont ignorées (pas de mapping EPCI→commune).
-- Source : Atmo France et les AASQA — licence ODbL (mention obligatoire UI).

CREATE TABLE IF NOT EXISTS public.atmo_map_daily (
  date_ech      date        NOT NULL,
  code_postal   text        NOT NULL,
  indice_global smallint    NOT NULL DEFAULT 0,
  no2           smallint    NOT NULL DEFAULT 0,
  o3            smallint    NOT NULL DEFAULT 0,
  pm10          smallint    NOT NULL DEFAULT 0,
  pm25          smallint    NOT NULL DEFAULT 0,
  so2           smallint    NOT NULL DEFAULT 0,
  nb_communes   integer     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date_ech, code_postal)
);

COMMENT ON TABLE public.atmo_map_daily IS
  'Indice ATMO qualité de l''air agrégé par code postal (max des communes du CP). Source ODbL Atmo France et les AASQA.';

ALTER TABLE public.atmo_map_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atmo_map_daily_read ON public.atmo_map_daily;
CREATE POLICY atmo_map_daily_read ON public.atmo_map_daily
  FOR SELECT TO authenticated USING (true);
