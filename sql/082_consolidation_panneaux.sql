-- ============================================================
-- 082 — Consolidation panneaux : global_ooh → panneaux_affichage
-- Date : 2026-07-02
-- Appliquée via MCP Supabase (migrations : consolidation_panneaux_step1_merge,
-- consolidation_panneaux_step2_drop_global_ooh)
--
-- Contexte (docs/AUDIT_IMPORTS.md, constat C4) :
-- Deux tables de panneaux concurrentes sans source de vérité :
--   - global_ooh (import ArcGIS, lue par la carte et le copilote)
--   - panneaux_affichage (import CSV, lue par le scoring)
-- Les 656 lignes CSV de panneaux_affichage étaient une copie dégradée du
-- même open data Brest (440 lignes empilées sur 96 positions — géocodage
-- raté, jusqu'à 51 panneaux sur un point ; régie "Inconnu" partout).
-- Décision : panneaux_affichage devient la seule table (elle porte les 6 RPC
-- de scoring) ; les données ArcGIS (1 434 lignes propres) remplacent les
-- anciennes lignes CSV, sauvegardées dans panneaux_affichage_backup_csv_20260702.
-- ============================================================

-- 1. Colonnes héritées de global_ooh
ALTER TABLE public.panneaux_affichage
  ADD COLUMN IF NOT EXISTS source      text,
  ADD COLUMN IF NOT EXISTS source_ref  text,
  ADD COLUMN IF NOT EXISTS adresse     text,
  ADD COLUMN IF NOT EXISTS code_insee  text,
  ADD COLUMN IF NOT EXISTS nb_faces    integer,
  ADD COLUMN IF NOT EXISTS metadata    jsonb,
  ADD COLUMN IF NOT EXISTS date_import timestamptz,
  ADD COLUMN IF NOT EXISTS date_maj    timestamptz;

-- 2. Unicité (source, source_ref) → upsert au ré-import ArcGIS (fix C6).
--    NULLs distincts : les lignes sans source (imports fichiers legacy) ne
--    sont pas contraintes.
ALTER TABLE public.panneaux_affichage
  ADD CONSTRAINT panneaux_affichage_source_source_ref_key UNIQUE (source, source_ref);

-- 3. Backup des anciennes lignes CSV puis remplacement par les données ArcGIS
--    (geom recalculé par le trigger trg_panneaux_auto_geom)
CREATE TABLE public.panneaux_affichage_backup_csv_20260702 AS
SELECT * FROM public.panneaux_affichage;

DELETE FROM public.panneaux_affichage;

INSERT INTO public.panneaux_affichage
  (id, lat, lng, reference_panneau, regie, type_panneau, ville, actif,
   source, source_ref, adresse, code_insee, nb_faces, metadata, date_import, date_maj,
   organization_id, data_source_id)
SELECT g.id, g.lat, g.lng, g.source_ref,
       NULLIF(g.regie, ''), g.type_panneau, initcap(lower(g.ville)),
       (g.statut = 'actif'),
       g.source, g.source_ref, g.adresse, g.code_insee, g.nb_faces, g.metadata,
       g.date_import, g.date_maj,
       ds.organization_id, ds.id
FROM public.global_ooh g
LEFT JOIN public.data_sources ds
  ON ds.mapping->>'source_key' = g.source AND ds.type = 'panneaux';

-- 4. get_sources_stats : bloc ooh → panneaux_affichage
CREATE OR REPLACE FUNCTION public.get_sources_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'iris', jsonb_build_object(
      'total',    (SELECT COUNT(*) FROM iris),
      'enrichis', (SELECT COUNT(*) FROM iris WHERE population IS NOT NULL AND population > 0)
    ),
    'transport', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM poi_france WHERE categorie = 'arret_transport'),
      'bus',   (SELECT COUNT(*) FROM poi_france WHERE categorie = 'arret_transport' AND sous_categorie = 'bus'),
      'train', (SELECT COUNT(*) FROM poi_france WHERE categorie = 'arret_transport' AND sous_categorie = 'train'),
      'tram',  (SELECT COUNT(*) FROM poi_france WHERE categorie = 'arret_transport' AND sous_categorie = 'tram'),
      'metro', (SELECT COUNT(*) FROM poi_france WHERE categorie = 'arret_transport' AND sous_categorie = 'metro')
    ),
    'flux', jsonb_build_object(
      'total',  (SELECT COUNT(*) FROM comptages_routiers WHERE source IN ('tmja_rrn_national','osm_highway_proxy')),
      'cerema', (SELECT COUNT(*) FROM comptages_routiers WHERE source = 'tmja_rrn_national'),
      'osm',    (SELECT COUNT(*) FROM comptages_routiers WHERE source = 'osm_highway_proxy')
    ),
    'carreaux', jsonb_build_object(
      'total', (SELECT reltuples::bigint FROM pg_class WHERE relname = 'carreaux_filosofi' AND relnamespace = 'public'::regnamespace)
    ),
    'ooh', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM panneaux_affichage WHERE actif = true)
    ),
    'poi', (
      SELECT jsonb_build_object(
        'total',       SUM(nb),
        'by_category', jsonb_agg(jsonb_build_object('categorie', categorie, 'nb', nb))
      )
      FROM poi_count_by_categorie()
    )
  );
$function$;

-- 5. Suppression de global_ooh
DROP TABLE IF EXISTS public.global_ooh;
DROP FUNCTION IF EXISTS public.fn_global_ooh_set_geom();

-- Post-consolidation :
--   - Les scores (score_ooh_final…) sont à 0 (DEFAULT) → relancer un scoring
--     depuis /map (ScoringPanel) ou /api/scoring.
--   - panneaux_affichage_backup_csv_20260702 peut être droppée après validation.
