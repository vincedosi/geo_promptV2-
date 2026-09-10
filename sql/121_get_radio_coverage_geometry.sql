-- 121 — get_radio_coverage_geometry
--
-- Repare la capture d'une couverture radio en zone custom.
--
-- CONSTAT : la fonction etait appelee par app/api/custom-geo/source/radio
-- mais n'avait JAMAIS ete ecrite — ni en base, ni dans sql/ (audit du
-- 2026-09-08, docs/AUDIT_BASE.md). La route repondait donc 400 a chaque appel,
-- sans repli : le bouton « couverture radio » du constructeur de zones existait
-- dans l'interface et ne pouvait pas fonctionner.
--
-- Contrat calque sur `get_voronoi_capture_geometry`, la source de capture
-- soeur : jsonb { geometry, metadata }, geometrie en 4326, multi-polygonisee,
-- `geometry` a NULL quand il n'y a rien a rendre.
--
-- ── Choix techniques, mesures a l'appui ──────────────────────────────────────
--
-- `rayon_couverture_m` est deja calcule et stocke sur chaque emetteur (11 836
-- lignes, toutes renseignees, de 6 a 54 km). La fonction n'invente aucun rayon :
-- elle unit des buffers de ce rayon.
--
-- Buffer sur le type `geography` et NON en Lambert-93 : 754 emetteurs sont en
-- outre-mer (jusqu'a -63 de longitude en Guadeloupe, +55.8 a La Reunion), ou
-- une projection metropolitaine produirait des formes fausses. `geography`
-- calcule sur l'ellipsoide et reste juste partout. Cout mesure : ~2,5 s dans le
-- pire cas contre ~0,95 s en 2154 — l'ecart est accepte, la justesse prime.
--
-- `quad_segs => 4` : 16 segments par cercle au lieu de 32. Sur des rayons
-- kilometriques l'ecart est invisible a l'ecran, et le nombre de sommets de
-- l'union est divise par deux.
--
-- Liaison via `emetteur_radio_stations` (N:N) et NON via
-- `emetteurs_radio.radio_id` : cette colonne existe mais est NULL sur les
-- 11 836 lignes. Passer par elle renverrait toujours zero emetteur.
--
-- Pas de decoupe sur `france_borders` : elle ne couvre que la metropole et
-- amputerait l'outre-mer. Le debord en mer est sans effet — un plan media se
-- resout en codes postaux, et il n'y en a pas sur l'eau.
--
-- Cout mesure (EXPLAIN ANALYZE, obligatoire par CLAUDE.md) :
--   21 emetteurs      → 188 ms
--   502 emetteurs     → 88 ms, 9 blocs lus
--   11 836 (France Inter, pire cas absolu) → ~2,5 s, 3 434 blocs lus
-- Compatible Nano : aucun full scan de table volumineuse, l'index
-- idx_ers_radio porte la selection.

CREATE OR REPLACE FUNCTION public.get_radio_coverage_geometry(
  p_radio_id        uuid,
  p_transmitter_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_geom     geometry;
  v_count    int;
  v_nom      text;
  v_rayon_min numeric;
  v_rayon_max numeric;
BEGIN
  IF p_radio_id IS NULL THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  SELECT nom INTO v_nom FROM public.radios WHERE id = p_radio_id;

  SELECT
    ST_Union(ST_Buffer(e.geom::geography, e.rayon_couverture_m, 'quad_segs=4')::geometry),
    COUNT(*),
    MIN(e.rayon_couverture_m),
    MAX(e.rayon_couverture_m)
  INTO v_geom, v_count, v_rayon_min, v_rayon_max
  FROM public.emetteurs_radio e
  JOIN public.emetteur_radio_stations ers ON ers.emetteur_id = e.id
  WHERE ers.radio_id = p_radio_id
    AND e.geom IS NOT NULL
    AND e.rayon_couverture_m IS NOT NULL
    AND e.rayon_couverture_m > 0
    -- Filtre optionnel : sous-ensemble d'emetteurs choisi dans l'interface.
    AND (p_transmitter_ids IS NULL OR e.id = ANY(p_transmitter_ids));

  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RETURN jsonb_build_object(
      'geometry', NULL,
      'metadata', jsonb_build_object('radio_id', p_radio_id, 'radio_nom', v_nom, 'transmitter_count', 0)
    );
  END IF;

  IF GeometryType(v_geom) = 'POLYGON' THEN v_geom := ST_Multi(v_geom); END IF;

  RETURN jsonb_build_object(
    'geometry', ST_AsGeoJSON(v_geom)::jsonb,
    'metadata', jsonb_build_object(
      'radio_id',           p_radio_id,
      'radio_nom',          v_nom,
      'transmitter_count',  v_count,
      'rayon_min_m',        v_rayon_min,
      'rayon_max_m',        v_rayon_max,
      'filtered',           p_transmitter_ids IS NOT NULL
    )
  );
END $function$;

-- Droits calques sur get_voronoi_capture_geometry (la capture soeur).
REVOKE ALL ON FUNCTION public.get_radio_coverage_geometry(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_radio_coverage_geometry(uuid, uuid[]) TO authenticated, service_role;
