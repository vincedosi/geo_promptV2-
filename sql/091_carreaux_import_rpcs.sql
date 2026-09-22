-- ============================================================
-- 091 — Versionnement des 2 RPC carreaux critiques (dette C1)
-- ============================================================
-- Ces fonctions existaient en base mais n'étaient versionnées dans AUCUN .sql
-- du repo → dérive DB↔repo. Capturées ici depuis
-- la définition live le 2026-07-03 (pg_get_functiondef). Aucune modification,
-- pur versionnement — voir docs/AUDIT_IMPORTS.md C1.
--
-- import_carreaux_batch     : upsert batch des carreaux (appelé par
--                             /api/admin/import-geo pendant l'import Shapefile).
-- populate_carreaux_columns : post-traitement — copie ind/ind_18_24/… du
--                             metadata JSONB vers les colonnes typées (batch
--                             100k, statement_timeout 90s). Orphelin déclenché
--                             à la main / via Inngest ; à orchestrer après import.

CREATE OR REPLACE FUNCTION public.import_carreaux_batch(
  p_idcars text[],
  p_resolutions text[],
  p_millesimes text[],
  p_geom_wkts text[],
  p_metadatas jsonb[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  n        INT := array_length(p_idcars, 1);
  i        INT;
  inserted INT := 0;
BEGIN
  FOR i IN 1..n LOOP
    INSERT INTO carreaux_filosofi (idcar, resolution, millesime, geom, metadata)
    VALUES (
      p_idcars[i],
      p_resolutions[i],
      p_millesimes[i],
      ST_GeomFromText(p_geom_wkts[i], 4326),
      p_metadatas[i]
    )
    ON CONFLICT (idcar, resolution, millesime) DO UPDATE
      SET geom     = EXCLUDED.geom,
          metadata = EXCLUDED.metadata;
    inserted := inserted + 1;
  END LOOP;
  RETURN inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.populate_carreaux_columns(p_batch_size integer DEFAULT 100000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated INT;
BEGIN
  SET LOCAL statement_timeout = '90s';

  UPDATE carreaux_filosofi
  SET
    ind       = (metadata->>'ind')::numeric,
    ind_18_24 = (metadata->>'ind_18_24')::numeric,
    ind_25_39 = (metadata->>'ind_25_39')::numeric,
    ind_40_54 = (metadata->>'ind_40_54')::numeric,
    ind_inc   = (metadata->>'ind_inc')::numeric
  WHERE id IN (
    SELECT id FROM carreaux_filosofi
    WHERE ind IS NULL
    LIMIT p_batch_size
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;
