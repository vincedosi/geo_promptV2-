-- ============================================================================
-- Migration 005 — Data Lake OOH
-- Tables : global_ooh (master) + import_runs_ooh (traçabilité)
-- À exécuter dans Supabase Dashboard > SQL Editor
-- ============================================================================

-- ─── Table maître des panneaux ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.global_ooh (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Traçabilité source
  source          text        NOT NULL,          -- 'arcgis_brest', 'csv_jcdecaux'...
  source_ref      text,                          -- ID stable dans la source (OBJECTID, etc.)
  -- Champs métier
  regie           text,                          -- Clear Channel, JCDecaux...
  type_panneau    text,                          -- domaine privé, abribus, 4x3...
  adresse         text,
  ville           text,
  code_insee      text,
  nb_faces        int,
  statut          text        DEFAULT 'actif',   -- actif / inactif / inconnu
  -- Géographie
  lat             float8      NOT NULL,
  lng             float8      NOT NULL,
  geom            geometry(Point, 4326),
  -- Données brutes
  metadata        jsonb       DEFAULT '{}',
  -- Horodatage
  date_import     timestamptz DEFAULT now(),
  date_maj        timestamptz DEFAULT now()
);

-- Index spatial pour les requêtes géographiques et le scoring
CREATE INDEX IF NOT EXISTS global_ooh_geom_idx  ON public.global_ooh USING GIST(geom);
CREATE INDEX IF NOT EXISTS global_ooh_source_idx ON public.global_ooh(source);
CREATE INDEX IF NOT EXISTS global_ooh_regie_idx  ON public.global_ooh(regie);
CREATE INDEX IF NOT EXISTS global_ooh_ville_idx  ON public.global_ooh(ville);

-- Contrainte d'unicité source + ref pour les upserts
-- Note : pas de WHERE partiel — PostgREST ne supporte pas les index partiels en ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS global_ooh_source_ref_uniq
  ON public.global_ooh(source, source_ref);

-- Trigger : calcul automatique de geom depuis lat/lng
CREATE OR REPLACE FUNCTION public.fn_global_ooh_set_geom()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  NEW.date_maj := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_global_ooh_set_geom ON public.global_ooh;
CREATE TRIGGER trg_global_ooh_set_geom
  BEFORE INSERT OR UPDATE ON public.global_ooh
  FOR EACH ROW EXECUTE FUNCTION public.fn_global_ooh_set_geom();

-- ─── Table de traçabilité des imports ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_runs_ooh (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  source          text        NOT NULL,          -- identifiant source
  url             text,                          -- URL ou nom de fichier
  lance_le        timestamptz DEFAULT now(),
  termine_le      timestamptz,
  statut          text        DEFAULT 'running', -- running / done / error
  nb_total        int         DEFAULT 0,
  nb_inseres      int         DEFAULT 0,
  nb_maj          int         DEFAULT 0,
  nb_doublons     int         DEFAULT 0,
  nb_erreurs      int         DEFAULT 0,
  erreurs         jsonb       DEFAULT '[]'
);

-- Accès service role
GRANT ALL ON public.global_ooh        TO service_role;
GRANT ALL ON public.import_runs_ooh   TO service_role;
